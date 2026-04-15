#!/usr/bin/env node
/**
 * Ensure SumatraPDF portable is available at resources/SumatraPDF.exe so
 * electron-builder can bundle it. We rely on Sumatra for silent PDF
 * printing because Chromium's webContents.print() ships blank pages on
 * some Windows thermal drivers.
 *
 * Runs as part of `pnpm --filter @restora/pos-desktop dist`. Skips the
 * download if the file already exists.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.exe';
const MIN_BYTES = 5 * 1024 * 1024; // real binary is ~16 MB — anything smaller is a redirect page.
const DEST = path.join(__dirname, '..', 'resources', 'SumatraPDF.exe');

if (fs.existsSync(DEST)) {
  const size = fs.statSync(DEST).size;
  if (size >= MIN_BYTES) {
    console.log(`[sumatra] already present (${size.toLocaleString()} bytes): ${DEST}`);
    return;
  }
  console.warn(`[sumatra] existing file is too small (${size} bytes) — redownloading`);
  fs.unlinkSync(DEST);
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });

function download(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        res.resume();
        return download(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const file = fs.createWriteStream(DEST);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(DEST); } catch {}
        reject(err);
      });
    }).on('error', reject);
  });
}

console.log(`[sumatra] downloading ${URL}`);
download(URL, 5)
  .then(() => {
    const size = fs.statSync(DEST).size;
    if (size < MIN_BYTES) {
      fs.unlinkSync(DEST);
      throw new Error(`downloaded file too small (${size} bytes)`);
    }
    console.log(`[sumatra] saved ${size.toLocaleString()} bytes -> ${DEST}`);
  })
  .catch((err) => {
    console.error('[sumatra] download failed:', err.message);
    console.error('[sumatra] manual fallback:');
    console.error('[sumatra]   download SumatraPDF-3.5.2-64.exe from https://www.sumatrapdfreader.org');
    console.error(`[sumatra]   save as ${DEST}`);
    process.exit(1);
  });
