import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 * Returns true if `clientIp` is covered by any entry in `allowlist`.
 * Entries may be single IPv4 addresses or CIDR blocks (e.g. "192.168.1.0/24").
 * Unparseable entries are skipped silently.
 *
 * IPv6 is NOT supported — callers using v6 should disable the gate or
 * add their LAN's mapped v4 address instead. Extending to v6 is a
 * future exercise; most restaurant LANs are v4-only anyway.
 */
export function ipMatches(clientIp: string | null | undefined, allowlist: string | null | undefined): boolean {
  if (!clientIp || !allowlist) return false;

  // The client IP may arrive as "::ffff:192.168.1.10" (v4-mapped v6) — strip
  // the prefix so dotted-quad parsing works.
  const normalized = clientIp.replace(/^::ffff:/, '');
  const client = ipToLong(normalized);
  if (client == null) return false;

  for (const rawEntry of allowlist.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const slashIdx = entry.indexOf('/');
    if (slashIdx < 0) {
      // Single IP
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
      // Only surface clientIp when the gate is actively blocking — helps
      // owners debug their allowlist from the guest's perspective without
      // leaking IPs on every happy-path call.
      clientIp: !allowed ? clientIp : null,
    };
  }
}
