import { getLocalDb } from '../db/local-db';

/**
 * When a mutation is served from the offline path we mint a synthetic ID and
 * hand it to the renderer. Later dependent mutations (add-item to that order,
 * take payment on that order) target the synthetic ID. When the outbox drains
 * and the server returns the real ID, we record the mapping here so subsequent
 * queued requests can be rewritten before being sent.
 */

export type RemapKind = 'order' | 'item' | 'payment';

export function recordSynthetic(syntheticId: string, kind: RemapKind): void {
  getLocalDb()
    .prepare(
      `INSERT OR IGNORE INTO id_remap (synthetic_id, real_id, kind, created_at_ms)
       VALUES (?, NULL, ?, ?)`,
    )
    .run(syntheticId, kind, Date.now());
}

export function mapSyntheticToReal(syntheticId: string, realId: string): void {
  getLocalDb()
    .prepare(
      `INSERT INTO id_remap (synthetic_id, real_id, kind, created_at_ms)
       VALUES (?, ?, 'order', ?)
       ON CONFLICT(synthetic_id) DO UPDATE SET real_id = excluded.real_id`,
    )
    .run(syntheticId, realId, Date.now());
}

export function resolveRealId(syntheticId: string): string | null {
  const row = getLocalDb()
    .prepare(`SELECT real_id FROM id_remap WHERE synthetic_id = ?`)
    .get(syntheticId) as { real_id: string | null } | undefined;
  return row?.real_id ?? null;
}

export function isSynthetic(id: string): boolean {
  // Synthetic IDs are minted with the `off_` prefix so we can cheaply tell
  // them apart from real cuids without a DB lookup.
  return id.startsWith('off_');
}

// Matches the exact synthetic ID format minted by `syntheticId()` in
// synthetic.ts: "off_" + kind ("order" | "item" | "pay") + "_" + 20 hex
// chars. Using `\b` here would fail because `_` is a word char, so we
// anchor explicitly on the prefix + known hex length.
export const SYNTHETIC_ID_REGEX = /off_(?:order|item|pay)_[a-f0-9]{20}/g;

/**
 * Rewrite a path segment that might contain a synthetic order / item id with
 * the real id once the drain learns it. Returns the original path if no
 * substitution applies yet.
 */
export function rewritePath(path: string): string {
  return path.replace(SYNTHETIC_ID_REGEX, (match) => {
    const real = resolveRealId(match);
    return real ?? match;
  });
}

/** True if any synthetic id is still present in the path after rewrite. */
export function pathHasSynthetic(path: string): boolean {
  SYNTHETIC_ID_REGEX.lastIndex = 0;
  return SYNTHETIC_ID_REGEX.test(path);
}
