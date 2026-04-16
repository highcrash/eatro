import { app } from 'electron';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

/**
 * Download (and locally cache) the branch logo so node-thermal-printer's
 * printImage() can rasterize it. Thermal ESC/POS printers only accept
 * raw PNG data, and we want to avoid re-downloading on every ticket.
 *
 * Strategy: hash the URL, keep the file under %APPDATA%/print-tmp/logo-<hash>.png
 * for 24 hours, re-download when the cache expires or the URL changes.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getCachedLogoPath(url: string | null | undefined): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const cacheDir = join(app.getPath('userData'), 'print-tmp');
  mkdirSync(cacheDir, { recursive: true });
  const hash = createHash('sha1').update(trimmed).digest('hex').slice(0, 16);
  const out = join(cacheDir, `logo-${hash}.png`);

  try {
    if (existsSync(out)) {
      const age = Date.now() - statSync(out).mtimeMs;
      if (age < CACHE_TTL_MS) return out;
    }

    const res = await fetch(trimmed);
    if (!res.ok) {
      log.warn(`[logo-cache] download ${trimmed} failed: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // node-thermal-printer only handles PNG; reject other types.
    // Cheap sniff: PNG starts with 89 50 4E 47 0D 0A 1A 0A.
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      log.warn(`[logo-cache] ${trimmed} is not a PNG; receipt logo suppressed`);
      return null;
    }
    writeFileSync(out, buf);
    log.info(`[logo-cache] cached ${buf.length} bytes -> ${out}`);
    return out;
  } catch (err) {
    log.warn(`[logo-cache] failed: ${(err as Error).message}`);
    return null;
  }
}
