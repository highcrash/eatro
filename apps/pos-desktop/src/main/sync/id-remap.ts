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

/**
 * Rewrite a path segment that might contain a synthetic order / item id with
 * the real id once the drain learns it. Returns the original path if no
 * substitution applies yet.
 */
export function rewritePath(path: string): string {
  // Capture every "/off_XXX" segment and try to swap.
  return path.replace(/\b(off_[A-Za-z0-9]+)\b/g, (match) => {
    const real = resolveRealId(match);
    return real ?? match;
  });
}
