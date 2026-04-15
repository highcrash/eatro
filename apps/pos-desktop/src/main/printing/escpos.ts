import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';
import type { PrinterSlot } from '../config/store';
import { probe, recordOutcome } from './printer-health';

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
 * Send an ESC/POS job to a networked thermal printer (TCP, port 9100).
 * One automatic retry on transient failure (timeout / dropped connection).
 * The final error is a typed ThermalError so callers can render a
 * cashier-friendly message. Updates the printer-health cache on every
 * outcome so the Diagnostics panel reflects reality within seconds.
 */
export async function sendThermalJob(slot: PrinterSlot, job: ThermalJob): Promise<void> {
  if (slot.mode !== 'network') {
    throw new ThermalError('config', 'sendThermalJob can only be called for network-mode slots', slot);
  }

  // Skip the attempt entirely if we already know the printer is down — the
  // cashier gets an instant error instead of waiting 4s for the library's
  // internal connect timeout. Force a fresh probe on first-run (cache empty).
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
      // Only retry timeouts / dropped connections. Protocol errors (the
      // printer rejected the command, bad font, etc.) won't succeed on
      // a second try and would double-print if they partially executed.
      if (typed.kind !== 'timeout' && typed.kind !== 'unreachable') break;
      if (attempt === 2) break;
    }
  }

  const typed = classifyError(lastErr, slot);
  recordOutcome(slot, { ok: false, error: `${typed.kind}: ${typed.message}` });
  throw typed;
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
