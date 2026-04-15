import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import log from 'electron-log';

/**
 * Print HTML to a named OS printer in two stages:
 *
 *   1. Render HTML → PDF bytes via webContents.printToPDF. This is a
 *      DOM capture path, so the rendering can't be blank.
 *   2. Shell out to the bundled SumatraPDF portable binary with the
 *      -print-to / -silent flags. SumatraPDF is the Windows de-facto
 *      standard for silent PDF printing from scripts; it handles every
 *      thermal driver we've seen where Chromium's silent-print path
 *      ships blank pages.
 *
 * Prior attempts (documented in git history): webContents.print
 * directly on HTML, webContents.print via Chromium's built-in PDF
 * viewer, PowerShell Start-Process -Verb PrintTo. All shipped blank
 * pages on this user's thermal driver. SumatraPDF is the escape hatch.
 */

export async function printHtmlToPdfThenShell(
  html: string,
  deviceName: string,
  opts: { pageSize?: { width: number; height: number }; landscape?: boolean } = {},
): Promise<void> {
  if (!deviceName) throw new Error('No printer selected for this slot.');

  const tmpDir = join(app.getPath('userData'), 'print-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const stem = randomBytes(6).toString('hex');
  const htmlPath = join(tmpDir, `${stem}.html`);
  const pdfPath = join(tmpDir, `${stem}.pdf`);

  const sanitized = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  writeFileSync(htmlPath, sanitized, 'utf8');
  log.info(`[pdf-print] html bytes: ${sanitized.length}, html=${htmlPath}`);

  // Stage 1: render HTML → PDF bytes.
  const renderWin = new BrowserWindow({
    x: -32000, y: -32000,
    width: 320, height: 1200,
    show: false,
    frame: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const loaded = new Promise<void>((resolve) => {
      if (!renderWin.webContents.isLoading()) resolve();
      else renderWin.webContents.once('did-finish-load', () => resolve());
    });
    await renderWin.loadFile(htmlPath);
    await loaded;
    await new Promise<void>((r) => setTimeout(r, 200));

    const pdfData = await renderWin.webContents.printToPDF({
      pageSize: opts.pageSize ?? { width: 80_000, height: 297_000 },
      printBackground: true,
      landscape: opts.landscape ?? false,
      margins: { top: 2, bottom: 2, left: 2, right: 2 },
    });
    writeFileSync(pdfPath, pdfData);
    log.info(`[pdf-print] pdf bytes: ${pdfData.length}, pdf=${pdfPath}`);
  } finally {
    try { if (!renderWin.isDestroyed()) renderWin.close(); } catch { /* noop */ }
  }

  // Stage 2: shell the PDF to the printer via bundled SumatraPDF.
  const sumatra = resolveSumatraPath();
  if (!sumatra) {
    throw new Error(
      'SumatraPDF.exe is missing from the bundle. Run `pnpm --filter @restora/pos-desktop fetch-resources` and rebuild the installer.',
    );
  }
  log.info(`[pdf-print] spawn: "${sumatra}" -print-to "${deviceName}" -silent "${pdfPath}"`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      sumatra,
      ['-print-to', deviceName, '-silent', '-print-settings', 'noscale', pdfPath],
      { windowsHide: true },
    );
    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (b) => { stdout += String(b); });
    child.stderr?.on('data', (b) => { stderr += String(b); });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) {
        log.info(`[pdf-print] SumatraPDF accepted by "${deviceName}"`);
        resolve();
      } else {
        log.error(`[pdf-print] SumatraPDF exit ${code}: stdout=${stdout.trim()} stderr=${stderr.trim()}`);
        reject(new Error(`SumatraPDF exit ${code}: ${(stderr || stdout).trim() || 'no output'}`));
      }
    });
  });

  // Keep html + pdf around for 30 s so an owner can inspect the PDF
  // manually if the print still goes wrong.
  setTimeout(() => {
    try { unlinkSync(htmlPath); } catch { /* noop */ }
    try { unlinkSync(pdfPath); } catch { /* noop */ }
  }, 30_000);
}

/**
 * SumatraPDF.exe lives at Resources/SumatraPDF.exe in a packaged build
 * (via electron-builder extraResources) and at apps/pos-desktop/resources/
 * during `pnpm dev`. Try both so dev and prod work.
 */
function resolveSumatraPath(): string | null {
  const packaged = join(process.resourcesPath, 'SumatraPDF.exe');
  if (existsSync(packaged)) return packaged;
  const dev = resolve(app.getAppPath(), 'resources', 'SumatraPDF.exe');
  if (existsSync(dev)) return dev;
  return null;
}
