/**
 * Domain matching used by license activation + verification.
 *
 * Two registered shapes:
 *   1. Plain:     "example.com"
 *   2. Wildcard:  "*.example.com"
 *
 * Match semantics (applied after normalize() on both sides):
 *   Plain       — matches its exact self only.
 *   Wildcard    — matches the bare root AND any subdomain depth
 *                 (1 to N extra labels). Practical for buyers who
 *                 want ONE purchase code to cover example.com,
 *                 www.example.com, app.example.com, staging.app.example.com.
 *
 * Deliberate non-features:
 *   - No nested `*.sub.*.foo.com`. Low value, adds regex-injection risk.
 *   - No trailing wildcard `example.*`. Leading only — matches intuition.
 *   - No port in pattern. Ports are stripped from host before matching;
 *     buyers license the DNS name, not the port.
 *   - IDN / punycode not normalised here — buyers must activate with
 *     the same form (usually xn--…) their server's Host header carries.
 *     Safer than silent IDNA conversions that could accidentally match
 *     unrelated Unicode lookalikes.
 *
 * The server uses this for diagnostic + admin "would this host
 * activate?" checks. The primary consumer is @restora/license-client
 * (next workspace) which runs it client-side against req.headers.host.
 */

/** Lowercase, strip leading www., drop trailing dot + any :port.
 *  Order matters: port → trailing dot → www. — so "example.com.:8080"
 *  collapses cleanly. Reordered (from port-last) 2026-04-18 after a
 *  spec caught the degenerate case. */
export function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase();
  const noPort = lower.replace(/:\d+$/, '');
  const noDot = noPort.replace(/\.$/, '');
  return noDot.replace(/^www\./, '');
}

/** Same as normalizeHost but preserves a leading `*.` wildcard. */
export function normalizePattern(pattern: string): string {
  const lower = pattern.trim().toLowerCase();
  if (lower.startsWith('*.')) {
    const rest = lower.slice(2).replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
    return `*.${rest}`;
  }
  return normalizeHost(lower);
}

/** Returns true iff `host` matches the registered `pattern`. Both are
 *  assumed to be normalised; callers normalise at the edge. */
export function domainMatches(pattern: string, host: string): boolean {
  if (!pattern || !host) return false;

  if (!pattern.startsWith('*.')) {
    return pattern === host;
  }

  // Wildcard: strip "*." and allow root OR any subdomain depth.
  // "*.example.com" matches:
  //   example.com                 ✓ (bare root)
  //   www.example.com             ✓
  //   a.b.example.com             ✓
  //   notexample.com              ✗
  //   example.com.attacker.io     ✗ (suffix-append attacks)
  const root = pattern.slice(2);
  if (host === root) return true;
  return host.endsWith(`.${root}`);
}

/** Admin + debug helper: tell the user whether a given host would
 *  activate against a given pattern. Used in the admin UI's "test
 *  your license" affordance and can be surfaced from the server. */
export function describeMatch(pattern: string, host: string): {
  ok: boolean;
  normalizedPattern: string;
  normalizedHost: string;
  reason: string;
} {
  const np = normalizePattern(pattern);
  const nh = normalizeHost(host);
  const ok = domainMatches(np, nh);
  const reason = ok
    ? np === nh
      ? 'exact match'
      : `matches wildcard "${np}"`
    : np.startsWith('*.')
      ? `host is outside the "${np.slice(2)}" family`
      : `license is plain "${np}", doesn't accept subdomains`;
  return { ok, normalizedPattern: np, normalizedHost: nh, reason };
}
