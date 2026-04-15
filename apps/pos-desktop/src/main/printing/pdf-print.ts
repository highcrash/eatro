import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import log from 'electron-log';

/**
 * Print HTML to a named OS printer by rendering the HTML to a PDF via
 * Chromium's printToPDF (reliable — runs offscreen, no paint race) and
 * then shell-invoking the system's default PDF handler with the
 * `PrintTo` verb. Works for any thermal / office printer driver that
 * accepts PDF (every Windows 10/11 default PDF handler: Edge, Adobe,
 * Foxit, SumatraPDF).
 *
 * This replaces the webContents.print() path that shipped blank pages
 * on some thermal drivers even after every paint / page-size tweak.
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

  // Strip any auto-print / auto-close scripts the shared templates embed
  // for the web-POS popup flow — same reason as the webContents.print path.
  const sanitized = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  writeFileSync(htmlPath, sanitized, 'utf8');
  log.info(`[pdf-print] html bytes: ${sanitized.length}, html=${htmlPath}`);

  const win = new BrowserWindow({
    x: -32000,
    y: -32000,
    width: 320,
    height: 1200,
    show: false,
    frame: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const finished = new Promise<void>((resolve) => {
      if (!win.webContents.isLoading()) resolve();
      else win.webContents.once('did-finish-load', () => resolve());
    });
    await win.loadFile(htmlPath);
    await finished;
    await new Promise<void>((r) => setTimeout(r, 300));

    // printToPDF is a bitmap-capture path that doesn't depend on the
    // BrowserWindow being painted, so we don't need the offscreen-visible
    // gymnastics — it renders from the DOM directly to a PDF buffer.
    const pdfData = await win.webContents.printToPDF({
      pageSize: opts.pageSize ?? { width: 80_000, height: 297_000 },
      printBackground: true,
      landscape: opts.landscape ?? false,
      margins: { top: 2, bottom: 2, left: 2, right: 2 },
    });
    writeFileSync(pdfPath, pdfData);
    log.info(`[pdf-print] pdf bytes: ${pdfData.length}, pdf=${pdfPath}`);
  } finally {
    try { if (!win.isDestroyed()) win.close(); } catch { /* noop */ }
  }

  // Shell out to PowerShell's Start-Process with the PrintTo verb. This
  // uses whatever app is registered as the default PDF handler (Edge
  // on a fresh Windows 10/11, Adobe / Foxit / SumatraPDF if installed).
  // The verb targets a specific printer by name — no print dialog.
  await new Promise<void>((resolve, reject) => {
    const cmd = `Start-Process -FilePath '${pdfPath.replace(/'/g, "''")}' -Verb PrintTo -ArgumentList '"${deviceName.replace(/'/g, "''")}"' -WindowStyle Hidden`;
    log.info(`[pdf-print] shell: powershell -NoProfile -Command "${cmd}"`);
    const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], {
      windowsHide: true,
      detached: false,
    });
    let stderr = '';
    ps.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    ps.on('error', (err) => reject(err));
    ps.on('exit', (code) => {
      if (code === 0) {
        log.info(`[pdf-print] accepted by "${deviceName}"`);
        resolve();
      } else {
        log.error(`[pdf-print] PowerShell exit ${code}: ${stderr.trim()}`);
        reject(new Error(`PrintTo failed (exit ${code}): ${stderr.trim() || 'no output'}`));
      }
    });
  });

  // Keep html + pdf around for 30 s so an owner can inspect them if the
  // print still goes wrong. Then clean up.
  setTimeout(() => {
    try { unlinkSync(htmlPath); } catch { /* noop */ }
    try { unlinkSync(pdfPath); } catch { /* noop */ }
  }, 30_000);
}
