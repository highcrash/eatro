import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import log from 'electron-log';

/**
 * Print HTML to a named OS printer in two stages, both driven by
 * Chromium so the Windows shell / PDF-viewer registration doesn't
 * matter:
 *
 *   1. Render HTML → PDF bytes via webContents.printToPDF. This is a
 *      DOM capture path, not paint-dependent, so it can't silently
 *      ship a blank bitmap the way webContents.print() could.
 *   2. Load the PDF into a fresh BrowserWindow (Chromium's built-in
 *      PDF viewer renders it) and drive that window with
 *      webContents.print({silent:true, deviceName}). The printer now
 *      receives a fully-rasterized PDF page instead of an HTML render
 *      that could still be in-flight.
 *
 * Why this works when the prior HTML-direct path didn't: the paint
 * race lived in the HTML render pipeline; by the time the PDF viewer
 * has a PDF loaded, the content is pre-rendered as a bitmap inside
 * the plugin and webContents.print captures that pristine surface.
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

  // Stage 2: load the PDF into a new window (Chromium renders it via the
  // built-in PDF viewer plugin) and silent-print that.
  const viewerWin = new BrowserWindow({
    x: -32000, y: -32000,
    width: 320, height: 1200,
    show: false,
    frame: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
    },
  });

  try {
    const pdfLoaded = new Promise<void>((resolve) => {
      if (!viewerWin.webContents.isLoading()) resolve();
      else viewerWin.webContents.once('did-finish-load', () => resolve());
    });
    await viewerWin.loadFile(pdfPath);
    await pdfLoaded;

    // The PDF viewer plugin needs a moment to rasterize the first page.
    viewerWin.showInactive();
    await new Promise<void>((r) => setTimeout(r, 800));

    await new Promise<void>((resolve, reject) => {
      try {
        viewerWin.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName,
            margins: { marginType: 'default' },
            ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
          },
          (success, failureReason) => {
            if (success) {
              log.info(`[pdf-print] accepted by "${deviceName}"`);
              resolve();
            } else {
              log.error(`[pdf-print] rejected by "${deviceName}": ${failureReason}`);
              reject(new Error(`Printer "${deviceName}" rejected the job: ${failureReason || 'no reason'}`));
            }
          },
        );
      } catch (err) {
        log.error(`[pdf-print] threw`, err);
        reject(err as Error);
      }
    });
  } finally {
    setTimeout(() => {
      try { if (!viewerWin.isDestroyed()) viewerWin.close(); } catch { /* noop */ }
    }, 200);
  }

  // Keep html + pdf around for 30 s so an owner can inspect the PDF
  // manually if the print still goes wrong.
  setTimeout(() => {
    try { unlinkSync(htmlPath); } catch { /* noop */ }
    try { unlinkSync(pdfPath); } catch { /* noop */ }
  }, 30_000);
}
