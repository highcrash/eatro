/**
 * Domain match semantics. Byte-identical behaviour to the license
 * server's apps/license-server/src/license/domain-match.ts — when you
 * touch one file, touch the other.
 *
 * Why two copies, not a shared dep: the license-server lives on `main`
 * and MUST NOT ship in the CodeCanyon zip. @restora/license-client
 * travels INTO that zip. A shared internal package would force either
 * server code into the zip or client code into the server's deploy,
 * both of which leak blast radius. The duplication is small and
 * well-tested on both sides.
 */

export function normalizeHost(host: string): string {
  // Order matters: strip port before trailing dot so "example.com.:8080"
  // collapses cleanly (port-then-dot). Leading www. goes last.
  const lower = host.trim().toLowerCase();
  const noPort = lower.replace(/:\d+$/, '');
  const noDot = noPort.replace(/\.$/, '');
  return noDot.replace(/^www\./, '');
}

export function normalizePattern(pattern: string): string {
  const lower = pattern.trim().toLowerCase();
  if (lower.startsWith('*.')) {
    const rest = lower.slice(2).replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
    return `*.${rest}`;
  }
  return normalizeHost(lower);
}

/**
 * Returns true iff `host` matches the registered `pattern`. Both inputs
 * should be pre-normalised by callers (the `*Host`/`*Pattern` helpers).
 *
 * Critical: for a wildcard `*.root` we require the host to EQUAL `root`
 * OR end with `.root`. Using endsWith('root') alone would falsely match
 * hosts like `notroot.com` and suffix-append attacks like
 * `root.com.attacker.io`.
 */
export function domainMatches(pattern: string, host: string): boolean {
  if (!pattern || !host) return false;
  if (!pattern.startsWith('*.')) return pattern === host;

  const root = pattern.slice(2);
  if (host === root) return true;
  return host.endsWith(`.${root}`);
}
