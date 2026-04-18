import type { Request } from 'express';

/**
 * Best-effort real-client IP, in priority order:
 *   1. CF-Connecting-IP   (CloudFlare authoritative visitor IP)
 *   2. X-Real-IP          (nginx)
 *   3. X-Forwarded-For[0] (leftmost = original client through proxies)
 *   4. req.ip             (Express, honours `trust proxy: true`)
 *
 * Strips the IPv4-mapped-IPv6 prefix `::ffff:` so downstream rate-limit
 * keys and CheckLog rows are stable across the same physical client
 * regardless of dual-stack quirks.
 */
export function extractClientIp(req: Request): string {
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
    (req.ip ? req.ip.replace(/^::ffff:/, '') : 'unknown')
  );
}
