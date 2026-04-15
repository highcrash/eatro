import { BrowserWindow } from 'electron';

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
    } catch {
      /* already gone */
    }
  };

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);

    // Wait for the first paint so Chromium has laid out the page before
    // asking it to print — otherwise silent:true jobs can ship a blank page.
    await new Promise<void>((resolve) => {
      if (win.webContents.isLoadingMainFrame()) {
        win.webContents.once('did-finish-load', () => resolve());
      } else {
        resolve();
      }
    });

    await new Promise<void>((resolve, reject) => {
      try {
        win.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName,
            pageSize: opts.pageSize ?? 'A4',
            landscape: opts.landscape ?? false,
            margins: { marginType: 'minimum' },
          },
          (success, failureReason) => {
            if (success) resolve();
            else reject(new Error(failureReason || 'Print job failed'));
          },
        );
      } catch (err) {
        reject(err as Error);
      }
    });
  } finally {
    // Give Chromium a tick to finish spooling before tearing the window down.
    setTimeout(safeClose, 50);
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
