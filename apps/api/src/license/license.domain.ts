/**
 * Host comparison for the gate. Mirrors the SAME normalization rules as
 * the license server's `apps/license-server/src/license/domain-match.ts`
 * AND the license-client's `packages/license-client/src/domain-match.ts`
 * (in the neawaslic repo). Behavior must stay byte-identical or
 * activate-vs-runtime checks will diverge.
 *
 * Why duplicated here too: this file participates in the request-time
 * gate that runs on every incoming HTTP request. Reaching into the
 * license-client at that hot path would pull in unnecessary code; this
 * helper is two pure functions and stays inline.
 *
 * Order: trim + lowercase → port → trailing dot → leading www.
 * (Reordering would re-open the bug fixed in neawaslic 8058245 where
 * "example.com.:8080" kept its trailing dot.)
 */

export function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase();
  const noPort = lower.replace(/:\d+$/, '');
  const noDot = noPort.replace(/\.$/, '');
  return noDot.replace(/^www\./, '');
}

export function domainMatches(pattern: string, host: string): boolean {
  if (!pattern || !host) return false;
  if (!pattern.startsWith('*.')) return pattern === host;
  const root = pattern.slice(2);
  if (host === root) return true;
  return host.endsWith(`.${root}`);
}

/**
 * Localhost / private-range hosts get a free pass during development so
 * a developer running `pnpm dev` doesn't have to activate against the
 * production license server. The list is intentionally narrow — anything
 * a buyer might plausibly reach via DNS still has to match the activated
 * domain. Toggled by NODE_ENV === 'development'.
 */
export function isDevHost(host: string): boolean {
  const h = normalizeHost(host);
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.localhost')) return true;
  return false;
}
