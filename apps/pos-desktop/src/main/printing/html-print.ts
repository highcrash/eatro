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

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
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

    await win.loadFile(tmpPath);

    // Windows BrowserWindows created with show: false sometimes skip paint
    // work, so silent webContents.print() captures a blank surface even
    // though the job was "accepted" by the driver. Nudging the window to
    // offscreen-visible forces a full paint pass on every driver we've
    // seen, while the coordinates keep it off the taskbar / screen.
    win.setBounds({ x: -32000, y: -32000, width: 600, height: 900 });
    win.showInactive();

    // 500 ms settle: ~16 ms is enough on fast machines but receipts with
    // webfont-ish monospace stacks need longer, and silent:true has no
    // built-in "ready" signal. 500 ms is cheap and fixes the blank-print
    // case.
    await new Promise<void>((r) => setTimeout(r, 500));

    await new Promise<void>((resolve, reject) => {
      try {
        const printOpts: Electron.WebContentsPrintOptions = {
          silent: true,
          printBackground: true,
          deviceName,
          landscape: opts.landscape ?? false,
          // 'default' (not 'none') — some thermal drivers treat 'none' as
          // "empty page" because Electron passes 0-width borders they
          // can't parse.
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
    setTimeout(safeClose, 150);
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
