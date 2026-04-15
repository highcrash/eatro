import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';
import type { PrinterSlot } from '../config/store';

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

/**
 * Send an ESC/POS job to a networked thermal printer (TCP, port 9100).
 * Throws on connection error or protocol failure — callers should surface the
 * message to the cashier and retry.
 */
export async function sendThermalJob(slot: PrinterSlot, job: ThermalJob): Promise<void> {
  if (slot.mode !== 'network') {
    throw new Error('sendThermalJob can only be called for network-mode slots');
  }

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${slot.host}:${slot.port}`,
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
    options: { timeout: 4000 },
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
