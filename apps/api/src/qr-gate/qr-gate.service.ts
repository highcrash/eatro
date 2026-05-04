import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Best-effort real client IP extractor. Priority order:
 *   1. CF-Connecting-IP      — CloudFlare's authoritative visitor IP
 *   2. X-Real-IP             — nginx-style
 *   3. X-Forwarded-For[0]    — first (leftmost) entry = original client
 *   4. req.ip                — Express, honors `trust proxy` setting
 *
 * Each candidate is trimmed and any v4-mapped-v6 prefix (`::ffff:`) is
 * stripped. Returns null if nothing usable is present (unlikely).
 *
 * Why not rely on req.ip alone? Behind CloudFlare → DO App Platform there
 * are 2+ proxy hops. `trust proxy: true` helps, but CF still sets
 * CF-Connecting-IP explicitly and we prefer that source when present.
 */
export function extractClientIp(req: Request): string | null {
  const pick = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const first = v.split(',')[0]?.trim();
    if (!first) return null;
    return first.replace(/^::ffff:/, '');
  };

  const h = req.headers;
  return (
    pick(h['cf-connecting-ip']) ??
    pick(h['x-real-ip']) ??
    pick(h['x-forwarded-for']) ??
    (req.ip ? req.ip.replace(/^::ffff:/, '') : null)
  );
}

// IPv4 dotted-quad parser. Returns the IP as a 32-bit unsigned number, or
// null for malformed input. Kept as a pure function so the allowlist
// matcher stays easy to reason about.
function ipToLong(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const byte = Number(p);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    n = (n * 256) + byte;
  }
  return n >>> 0; // force unsigned
}

/**
 * Parse an IPv6 address string into a 128-bit BigInt (or null for
 * malformed). Handles `::` zero-collapse and embedded IPv4 tail
 * (e.g. `::ffff:192.168.1.10`, `2001:db8::192.168.1.10`).
 *
 * We hand-roll instead of pulling in a dep — the algorithm is small
 * and the QR-gate path is hot enough that we don't want a node_modules
 * weight bump for one function.
 */
function ip6ToBig(ip: string): bigint | null {
  if (!ip) return null;
  let s = ip.trim();
  if (!s.includes(':')) return null;

  // Embedded IPv4 tail: convert it to two hex groups and graft onto the
  // v6 prefix. ::ffff:1.2.3.4 → ::ffff:0102:0304
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipToLong(tail);
    if (v4 == null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  // Split on `::` — at most one occurrence.
  let head: string[] = [];
  let body: string[] = [];
  if (s.includes('::')) {
    const [left, right, extra] = s.split('::');
    if (extra !== undefined) return null; // more than one `::` is malformed
    head = left ? left.split(':') : [];
    body = right ? right.split(':') : [];
    const fillers = 8 - head.length - body.length;
    if (fillers < 0) return null;
    head = [...head, ...Array(fillers).fill('0'), ...body];
  } else {
    head = s.split(':');
    if (head.length !== 8) return null;
  }

  let n = 0n;
  for (const grp of head) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(grp)) return null;
    n = (n << 16n) | BigInt(parseInt(grp, 16));
  }
  return n;
}

function isIPv6(s: string): boolean {
  return s.includes(':') && !s.startsWith('::ffff:');
}

/**
 * Returns true if `clientIp` is covered by any entry in `allowlist`.
 * Entries may be single IPv4/IPv6 addresses or CIDR blocks
 * (e.g. "192.168.1.0/24" or "2001:db8::/32"). Unparseable entries are
 * skipped silently. Allowlist may freely mix v4 and v6 entries; only
 * entries of the matching family are evaluated against the client IP
 * (a v4 client is never matched against a v6 entry).
 *
 * Cellular hotspots increasingly hand out v6-only addresses (Bangladesh
 * GP / Robi included), so this matcher needs to evaluate both — the
 * v4-only predecessor silently denied every v6 client.
 */
export function ipMatches(clientIp: string | null | undefined, allowlist: string | null | undefined): boolean {
  if (!clientIp || !allowlist) return false;

  // The client IP may arrive as "::ffff:192.168.1.10" (v4-mapped v6) — strip
  // the prefix so dotted-quad parsing works for the v4 path.
  const normalized = clientIp.replace(/^::ffff:/, '');
  const clientIsV6 = isIPv6(normalized);

  if (clientIsV6) {
    const client6 = ip6ToBig(normalized);
    if (client6 == null) return false;
    for (const rawEntry of allowlist.split(',')) {
      const entry = rawEntry.trim();
      if (!entry || !isIPv6(entry)) continue;
      const slashIdx = entry.indexOf('/');
      if (slashIdx < 0) {
        const ip = ip6ToBig(entry);
        if (ip != null && ip === client6) return true;
        continue;
      }
      const base = ip6ToBig(entry.slice(0, slashIdx));
      const bits = Number(entry.slice(slashIdx + 1));
      if (base == null || !Number.isInteger(bits) || bits < 0 || bits > 128) continue;
      if (bits === 0) return true;
      const mask = (~0n << BigInt(128 - bits)) & ((1n << 128n) - 1n);
      if ((client6 & mask) === (base & mask)) return true;
    }
    return false;
  }

  const client = ipToLong(normalized);
  if (client == null) return false;
  for (const rawEntry of allowlist.split(',')) {
    const entry = rawEntry.trim();
    if (!entry || isIPv6(entry)) continue;
    const slashIdx = entry.indexOf('/');
    if (slashIdx < 0) {
      const ip = ipToLong(entry);
      if (ip != null && ip === client) return true;
      continue;
    }
    const base = ipToLong(entry.slice(0, slashIdx));
    const bits = Number(entry.slice(slashIdx + 1));
    if (base == null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    if (bits === 0) return true; // 0.0.0.0/0 allows everything
    const mask = (~((1 << (32 - bits)) - 1)) >>> 0;
    if ((client & mask) === (base & mask)) return true;
  }
  return false;
}

@Injectable()
export class QrGateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluate whether a given client IP is allowed to use QR ordering for a
   * branch. Returns the public gate payload (wifi details, instructions,
   * allowed flag) that the QR app uses to decide between rendering the
   * order UI and the "please connect to our Wi-Fi" page.
   */
  async evaluate(branchId: string, clientIp: string | null) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
    });
    if (!branch) return null;

    const b = branch as unknown as Record<string, unknown>;
    const gateEnabled = Boolean(b.qrGateEnabled);
    const allowlist = (b.qrAllowedIps as string | null) ?? null;

    // Gate disabled → allow, regardless of IP.
    const allowed = gateEnabled ? ipMatches(clientIp, allowlist) : true;

    return {
      allowed,
      gateEnabled,
      branchName: branch.name,
      wifiSsid: (b.wifiSsid as string | null) ?? null,
      wifiPass: branch.wifiPass ?? null,
      message: (b.qrGateMessage as string | null) ?? null,
      // Always surface the detected client IP so the admin can configure
      // the allowlist from the "what IP do I actually look like" view.
      // This isn't sensitive (the caller already knows their own IP) and
      // the debug visibility outweighs the minor leak.
      clientIp,
    };
  }
}
