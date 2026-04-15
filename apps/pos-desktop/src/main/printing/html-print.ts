import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import log from 'electron-log';

/**
 * Tracks the app's main renderer window so we can query printers from it
 * without accidentally picking up one of the short-lived hidden print
 * windows we spawn for each job.
 */
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindowForPrinting(win: BrowserWindow): void {
  mainWindowRef = win;
  win.on('closed', () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });
}

/**
 * Print an HTML string silently to a named OS printer via Electron's built-in
 * webContents.print(). Used for:
 *   - OS-printer-mode thermal slots (prints rendered HTML to e.g. an 80 mm
 *     driver-installed printer). Looks fine for receipts but cannot open a
 *     cash drawer — that requires raw ESC/POS bytes.
 *   - A4 report slot.
 *
 * The caller supplies fully-formed HTML (including <html>/<body>); this
 * function doesn't wrap it.
 */
export async function printHtmlToDevice(
  html: string,
  deviceName: string,
  opts: { pageSize?: 'A4' | { width: number; height: number }; landscape?: boolean } = {},
): Promise<void> {
  if (!deviceName) {
    throw new Error('No printer selected for this slot.');
  }

  // Write the HTML to a temp file and loadFile(). data: URLs past a few
  // kilobytes get truncated by Chromium on Windows in ways that show as
  // "blank page printed" or silent failures with no callback feedback.
  const tmpDir = join(app.getPath('userData'), 'print-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `${randomBytes(6).toString('hex')}.html`);
  // Strip any auto-print / auto-close scripts that the web-POS popup flow
  // embeds in shared templates (e.g. kitchen-ticket.ts). In the desktop
  // shell we drive printing from the main process and a self-closing page
  // destroys the BrowserWindow before our webContents.print() fires,
  // producing the confusing "Object has been destroyed" error.
  const sanitized = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  writeFileSync(tmpPath, sanitized, 'utf8');
  log.info(`[print] html bytes written: ${sanitized.length}`);

  // Create the print window with explicit dimensions matching the page we
  // want Chromium to lay out. Positioning it offscreen (but visible) forces
  // the compositor to actually paint — show:false windows have been observed
  // to ship blank surfaces to webContents.print on some Windows driver
  // combos.
  const win = new BrowserWindow({
    x: -32000,
    y: -32000,
    width: 320,   // ~80 mm at 96 DPI
    height: 1200,
    show: false,
    frame: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  });

  const safeClose = () => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch { /* already gone */ }
    try { unlinkSync(tmpPath); } catch { /* temp already gone */ }
  };

  try {
    log.info(`[print] job -> "${deviceName}" (tmp: ${tmpPath}, pageSize: ${opts.pageSize ? JSON.stringify(opts.pageSize) : 'driver default'})`);

    // Set up the did-finish-load listener BEFORE loadFile so we don't miss
    // the event on fast local files.
    const finished = new Promise<void>((resolve) => {
      if (!win.webContents.isLoading()) resolve();
      else win.webContents.once('did-finish-load', () => resolve());
    });

    await win.loadFile(tmpPath);
    await finished;

    // Show the window so paint happens. showInactive keeps it from stealing
    // focus; the offscreen x,y keeps it out of sight.
    win.showInactive();

    // 800 ms settle gives the compositor time for the first paint cycle.
    await new Promise<void>((r) => setTimeout(r, 800));

    // Diagnostic snapshot: capture what Chromium actually rendered and save
    // it next to the HTML. If the PNG is blank we have a render problem;
    // if it has the receipt, we have a print-pipeline problem. Saves the
    // guessing game.
    try {
      const image = await win.webContents.capturePage();
      const pngPath = tmpPath.replace(/\.html$/, '.png');
      writeFileSync(pngPath, image.toPNG());
      log.info(`[print] render snapshot saved: ${pngPath} (${image.getSize().width}x${image.getSize().height})`);
    } catch (err) {
      log.warn(`[print] capturePage failed: ${(err as Error).message}`);
    }

    await new Promise<void>((resolve, reject) => {
      try {
        const printOpts: Electron.WebContentsPrintOptions = {
          silent: true,
          printBackground: true,
          deviceName,
          landscape: opts.landscape ?? false,
          margins: { marginType: 'default' },
        };
        if (opts.pageSize) printOpts.pageSize = opts.pageSize;

        win.webContents.print(printOpts, (success, failureReason) => {
          if (success) {
            log.info(`[print] accepted by "${deviceName}"`);
            resolve();
          } else {
            log.error(`[print] rejected by "${deviceName}": ${failureReason}`);
            reject(new Error(`Printer "${deviceName}" rejected the job: ${failureReason || 'no reason given'}`));
          }
        });
      } catch (err) {
        log.error(`[print] threw:`, err);
        reject(err as Error);
      }
    });
  } finally {
    // Keep the html + png around for 30 seconds so an owner can inspect the
    // render, then clean up. Skipping the unlink in safeClose for temp
    // files so they survive long enough to be useful.
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.close(); } catch { /* noop */ }
    }, 150);
    setTimeout(() => {
      try { unlinkSync(tmpPath); } catch { /* noop */ }
      try { unlinkSync(tmpPath.replace(/\.html$/, '.png')); } catch { /* noop */ }
    }, 30_000);
    void safeClose;
  }
}

/**
 * Query the app's main renderer for the list of printers. Falls back to
 * scanning BrowserWindows if the main ref is missing (should only happen
 * during first-run boot).
 */
export async function listOsPrinters(): Promise<Array<{ name: string; description?: string; isDefault?: boolean }>> {
  const win = pickPrinterQueryWindow();
  if (!win) return [];
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      description: p.description,
      isDefault: p.isDefault,
    }));
  } catch {
    return [];
  }
}

function pickPrinterQueryWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef;
  // Pick the first non-destroyed, visible window — avoid hidden print windows.
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (!w.isVisible()) continue;
    return w;
  }
  return null;
}
