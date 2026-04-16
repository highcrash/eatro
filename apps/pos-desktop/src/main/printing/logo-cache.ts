import { app } from 'electron';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { PNG } from 'pngjs';
import log from 'electron-log';

/**
 * Download + resize the branch logo for thermal printing, cached to disk
 * so we don't re-download or re-scale on every receipt.
 *
 * Why resize ourselves: node-thermal-printer streams the PNG pixels
 * straight into ESC/POS GS v 0 at the image's native dimensions. A logo
 * that's 1200 px wide would overflow an 80 mm thermal printer (max
 * ~576 dots) and either get clipped or rejected. Scaling to the admin-
 * configured width (% of paper) produces a clean banner every time.
 *
 * Cache key includes the target width so changing the width setting
 * invalidates immediately.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Usable print width on an 80 mm thermal printer. Most drivers max out at
// 576 dots (24 × 24 characters) after accounting for the paper margin.
const MAX_DOT_WIDTH = 576;

export async function getCachedLogoPath(url: string | null | undefined, widthPct = 80): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const clampedPct = Math.min(100, Math.max(10, Math.round(widthPct)));
  const targetWidth = Math.round(MAX_DOT_WIDTH * (clampedPct / 100));

  const cacheDir = join(app.getPath('userData'), 'print-tmp');
  mkdirSync(cacheDir, { recursive: true });
  const hash = createHash('sha1').update(`${trimmed}|${targetWidth}`).digest('hex').slice(0, 16);
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
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < 8 || raw[0] !== 0x89 || raw[1] !== 0x50 || raw[2] !== 0x4e || raw[3] !== 0x47) {
      log.warn(`[logo-cache] ${trimmed} is not a PNG; receipt logo suppressed`);
      return null;
    }

    const src = PNG.sync.read(raw);
    // Skip resize when the source already matches (within 4 px either way
    // — rounding drift from admin slider changes).
    const needsResize = Math.abs(src.width - targetWidth) > 4;
    const finalBytes = needsResize ? resizePng(src, targetWidth) : raw;
    writeFileSync(out, finalBytes);
    log.info(`[logo-cache] cached (${src.width}→${needsResize ? targetWidth : src.width} dots, ${finalBytes.length} bytes) -> ${out}`);
    return out;
  } catch (err) {
    log.warn(`[logo-cache] failed: ${(err as Error).message}`);
    return null;
  }
}

/** Nearest-neighbor PNG resize. Sharp-enough for receipt logos which
 *  print at ~180 DPI — any fancier filter would just get smeared by the
 *  thermal head's dot-matrix output. Preserves aspect ratio. */
function resizePng(src: PNG, targetWidth: number): Buffer {
  if (targetWidth <= 0) return PNG.sync.write(src);
  const scale = targetWidth / src.width;
  const targetHeight = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width: targetWidth, height: targetHeight });
  const s = src.data;
  const d = dst.data;
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * targetWidth + x) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = s[si + 3];
    }
  }
  return PNG.sync.write(dst);
}
