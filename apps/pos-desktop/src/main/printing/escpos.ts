import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';
import type { PrinterSlot } from '../config/store';
import { probe, recordOutcome } from './printer-health';
import { sendRawToWindowsPrinter } from './windows-raw-print';

export interface ThermalJobLine {
  kind: 'align-center' | 'align-left' | 'bold-on' | 'bold-off' | 'double-on' | 'double-off' | 'divider' | 'newline' | 'cut';
}

export interface ThermalJobText {
  kind: 'text';
  text: string;
  bold?: boolean;
  size?: 'normal' | 'large';
}

export type ThermalJobItem = ThermalJobLine | ThermalJobText;

export interface ThermalJob {
  lines: ThermalJobItem[];
  openCashDrawer?: boolean;
}

export type ThermalErrorKind = 'unreachable' | 'timeout' | 'protocol' | 'config';

export class ThermalError extends Error {
  readonly kind: ThermalErrorKind;
  readonly slot: PrinterSlot;
  constructor(kind: ThermalErrorKind, message: string, slot: PrinterSlot) {
    super(message);
    this.name = 'ThermalError';
    this.kind = kind;
    this.slot = slot;
  }
}

/**
 * Classify a raw exception from node-thermal-printer / the TCP socket into
 * a ThermalErrorKind. node-thermal-printer doesn't expose a typed error
 * channel, so we match on the error code + message. "out of paper" and
 * "cover open" would live here too, but those require polling the printer's
 * realtime status byte (ESC/POS GS r) which the library doesn't surface.
 */
function classifyError(err: unknown, slot: PrinterSlot): ThermalError {
  const message = (err as Error)?.message ?? String(err);
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /not reachable/i.test(message)) {
    return new ThermalError('unreachable', message, slot);
  }
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) {
    return new ThermalError('timeout', message, slot);
  }
  return new ThermalError('protocol', message, slot);
}

/**
 * Send an ESC/POS job to a thermal printer. Two transports:
 *
 *   - network TCP (port 9100): one retry on timeout / dropped connection,
 *     health-probe guard so an unreachable printer fails instantly
 *     instead of waiting 4 s for the library timeout.
 *   - os-printer: build the ESC/POS byte buffer with node-thermal-printer,
 *     then spool it RAW through the Windows print spooler via the
 *     WritePrinter Win32 API. Bypasses every GDI / PDF rasterizer — the
 *     printer receives bytes it natively understands. This is the only
 *     reliable path for USB thermal printers like the Rongta RP335A
 *     where Windows GDI drivers produce blank pages from rasterized
 *     bitmaps.
 */
export async function sendThermalJob(slot: PrinterSlot, job: ThermalJob): Promise<void> {
  if (slot.mode === 'disabled') {
    throw new ThermalError('config', 'Printer slot is disabled', slot);
  }

  if (slot.mode === 'os-printer') {
    // Build the ESC/POS byte buffer in-memory (not executed), then
    // hand it to the Windows spooler in RAW mode via PowerShell.
    const startedAt = Date.now();
    try {
      const bytes = await buildEscposBytes(job);
      await sendRawToWindowsPrinter(slot.deviceName, bytes);
      recordOutcome(slot, { ok: true, latencyMs: Date.now() - startedAt });
      return;
    } catch (err) {
      const typed = classifyError(err, slot);
      recordOutcome(slot, { ok: false, error: `${typed.kind}: ${typed.message}` });
      throw typed;
    }
  }

  // network mode
  const health = await probe(slot);
  if (health.status === 'unreachable') {
    recordOutcome(slot, { ok: false, error: health.lastError ?? 'unreachable' });
    throw new ThermalError('unreachable', `Printer at ${slot.host}:${slot.port} is not reachable (${health.lastError ?? 'no response'})`, slot);
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    try {
      await runJob(slot, job);
      recordOutcome(slot, { ok: true, latencyMs: Date.now() - startedAt });
      return;
    } catch (err) {
      lastErr = err;
      const typed = classifyError(err, slot);
      if (typed.kind !== 'timeout' && typed.kind !== 'unreachable') break;
      if (attempt === 2) break;
    }
  }

  const typed = classifyError(lastErr, slot);
  recordOutcome(slot, { ok: false, error: `${typed.kind}: ${typed.message}` });
  throw typed;
}

/**
 * Compile a ThermalJob into raw ESC/POS bytes. We instantiate a
 * ThermalPrinter against a dummy interface — the library's command
 * methods buffer bytes into an internal buffer without hitting the
 * wire, so getBuffer() returns the full command stream we can then
 * ship ourselves via whatever transport we choose.
 */
async function buildEscposBytes(job: ThermalJob): Promise<Buffer> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    // Dummy interface — we never call execute(), we call getBuffer().
    interface: 'tcp://127.0.0.1:1',
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
  });

  for (const line of job.lines) {
    switch (line.kind) {
      case 'align-center': printer.alignCenter(); break;
      case 'align-left': printer.alignLeft(); break;
      case 'bold-on': printer.bold(true); break;
      case 'bold-off': printer.bold(false); break;
      case 'double-on': printer.setTextDoubleHeight(); printer.setTextDoubleWidth(); break;
      case 'double-off': printer.setTextNormal(); break;
      case 'divider': printer.drawLine(); break;
      case 'newline': printer.newLine(); break;
      case 'cut': printer.cut(); break;
      case 'text':
        if (line.bold) printer.bold(true);
        if (line.size === 'large') { printer.setTextDoubleHeight(); printer.setTextDoubleWidth(); }
        printer.println(line.text);
        if (line.size === 'large') printer.setTextNormal();
        if (line.bold) printer.bold(false);
        break;
    }
  }
  if (job.openCashDrawer) printer.openCashDrawer();

  const buf = printer.getBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as unknown as Uint8Array);
}

async function runJob(slot: Extract<PrinterSlot, { mode: 'network' }>, job: ThermalJob): Promise<void> {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${slot.host}:${slot.port}`,
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
    options: { timeout: 3000 },
  });

  const online = await printer.isPrinterConnected();
  if (!online) {
    throw new Error(`Printer at ${slot.host}:${slot.port} is not reachable`);
  }

  for (const line of job.lines) {
    switch (line.kind) {
      case 'align-center': printer.alignCenter(); break;
      case 'align-left': printer.alignLeft(); break;
      case 'bold-on': printer.bold(true); break;
      case 'bold-off': printer.bold(false); break;
      case 'double-on': printer.setTextDoubleHeight(); printer.setTextDoubleWidth(); break;
      case 'double-off': printer.setTextNormal(); break;
      case 'divider': printer.drawLine(); break;
      case 'newline': printer.newLine(); break;
      case 'cut': await printer.cut(); break;
      case 'text':
        if (line.bold) printer.bold(true);
        if (line.size === 'large') { printer.setTextDoubleHeight(); printer.setTextDoubleWidth(); }
        printer.println(line.text);
        if (line.size === 'large') printer.setTextNormal();
        if (line.bold) printer.bold(false);
        break;
    }
  }

  if (job.openCashDrawer) {
    printer.openCashDrawer();
  }

  await printer.execute();
}
