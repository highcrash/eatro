import { app } from 'electron';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import log from 'electron-log';

/**
 * Send raw bytes (ESC/POS commands) to a Windows-installed printer by
 * name. Bypasses every GDI / HTML / PDF rendering path entirely — the
 * bytes go straight through the Windows print spooler in RAW mode to the
 * printer, which speaks ESC/POS natively.
 *
 * Implemented via PowerShell + Add-Type that pulls in the winspool.drv
 * WritePrinter API. No native npm module, no bundled binary — works on
 * any Windows with PowerShell 5+ (i.e. every Windows 10/11).
 *
 * This is the path that works for thermal receipt printers (Rongta,
 * Epson TM-T20, Xprinter, etc.) that accept ESC/POS but return blank
 * pages when Chromium or SumatraPDF hand them rasterized bitmaps.
 */

const PS_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)] [string] $Printer,
  [Parameter(Mandatory=$true)] [string] $File
)

$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  // Pass DOCINFOA by ref so the struct is marshalled as a pointer-to-struct
  // exactly as StartDocPrinterA expects. The LPStruct attribute we had was
  // silently wrong on some .NET runtimes and caused StartDocPrinter to fail.
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static string Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      return "OpenPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ")";
    }
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "Restora POS ESC/POS";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, ref di)) {
        return "StartDocPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ")";
      }
      try {
        if (!StartPagePrinter(h)) {
          return "StartPagePrinter failed (Win32 " + Marshal.GetLastWin32Error() + ")";
        }
        try {
          IntPtr buf = Marshal.AllocCoTaskMem(data.Length);
          Marshal.Copy(data, 0, buf, data.Length);
          try {
            int written;
            if (!WritePrinter(h, buf, data.Length, out written)) {
              return "WritePrinter failed (Win32 " + Marshal.GetLastWin32Error() + ")";
            }
            if (written != data.Length) {
              return "WritePrinter wrote " + written + " of " + data.Length + " bytes";
            }
            return "OK " + written;
          } finally { Marshal.FreeCoTaskMem(buf); }
        } finally { EndPagePrinter(h); }
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

Add-Type -TypeDefinition $source -Language CSharp | Out-Null
$bytes = [System.IO.File]::ReadAllBytes($File)
$result = [RawPrinterHelper]::Send($Printer, $bytes)
Write-Output $result
if ($result -like "OK*") { exit 0 } else { exit 1 }
`;

export async function sendRawToWindowsPrinter(deviceName: string, bytes: Buffer): Promise<void> {
  if (!deviceName) throw new Error('No printer selected.');
  if (!bytes || bytes.length === 0) throw new Error('Nothing to send.');

  // Prepend ESC @ (init) and append a feed-and-cut tail. Some ESC/POS
  // printers hold the buffer in a funny state without an explicit init —
  // sending one costs 2 bytes and fixes mystery "printer took bytes but
  // printed nothing" cases.
  const INIT = Buffer.from([0x1b, 0x40]);
  const TAIL_FEED = Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]);
  const FULL_CUT = Buffer.from([0x1d, 0x56, 0x00]);
  const framed = Buffer.concat([INIT, bytes, TAIL_FEED, FULL_CUT]);

  const tmpDir = join(app.getPath('userData'), 'print-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const binPath = join(tmpDir, `${randomBytes(6).toString('hex')}.escpos`);
  writeFileSync(binPath, framed);
  const previewLen = Math.min(40, framed.length);
  const hex = Array.from(framed.subarray(0, previewLen)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  log.info(`[raw-print] ${framed.length} bytes -> "${deviceName}" (bin=${binPath})`);
  log.info(`[raw-print] first ${previewLen} bytes: ${hex}`);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT, '-Printer', deviceName, '-File', binPath],
        { windowsHide: true },
      );
      let stderr = '';
      let stdout = '';
      child.stdout?.on('data', (b) => { stdout += String(b); });
      child.stderr?.on('data', (b) => { stderr += String(b); });
      child.on('error', (err) => reject(err));
      child.on('exit', (code) => {
        if (code === 0) {
          log.info(`[raw-print] spooled to "${deviceName}": ${stdout.trim()}`);
          resolve();
        } else {
          log.error(`[raw-print] PowerShell exit ${code}: ${stderr.trim()}`);
          reject(new Error(`Raw print failed: ${stderr.trim() || 'no output'}`));
        }
      });
    });
  } finally {
    setTimeout(() => { try { unlinkSync(binPath); } catch { /* noop */ } }, 30_000);
  }
}
