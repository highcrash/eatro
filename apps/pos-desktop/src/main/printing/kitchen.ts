import { renderKitchenTicketHtml, type KitchenTicketInput } from '@restora/utils';
import { getPrinters } from '../config/store';
import { sendThermalJob, type ThermalJob } from './escpos';
import { printHtmlToPdfThenShell } from './pdf-print';

/**
 * Print a kitchen ticket on the configured kitchen printer.
 * Throws with a human-readable message if the slot is disabled or the print fails.
 */
export async function printKitchenTicket(ticket: KitchenTicketInput): Promise<void> {
  const slot = (await getPrinters()).kitchen;

  if (slot.mode === 'disabled') {
    throw new Error('Kitchen printer is not configured. Set it in Printer Settings.');
  }

  if (slot.mode === 'network') {
    await sendThermalJob(slot, buildKitchenJob(ticket));
    return;
  }

  // os-printer path: render HTML → PDF (reliable across thermal drivers)
  // and shell it to the printer via the default PDF handler. See
  // pdf-print.ts for the full reasoning; webContents.print() shipped
  // blank pages on some drivers even after every fix we could apply.
  const html = renderKitchenTicketHtml(ticket);
  await printHtmlToPdfThenShell(html, slot.deviceName, {
    pageSize: { width: 80_000, height: 297_000 },
  });
}

function buildKitchenJob(ticket: KitchenTicketInput): ThermalJob {
  const job: ThermalJob = { lines: [] };
  const createdAt = new Date(ticket.createdAt);
  const destination = ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.type;
  const activeItems = (ticket.items ?? []).filter((i) => !i.voidedAt);

  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: 'KITCHEN ORDER', bold: true, size: 'large' });
  job.lines.push({ kind: 'text', text: `#${ticket.orderNumber} - ${destination}` });
  job.lines.push({ kind: 'text', text: createdAt.toLocaleTimeString() });
  job.lines.push({ kind: 'divider' });

  job.lines.push({ kind: 'align-left' });
  for (const it of activeItems) {
    job.lines.push({ kind: 'text', text: `${it.quantity}x  ${it.menuItemName}`, bold: true });
    if (it.notes) job.lines.push({ kind: 'text', text: `   -> ${it.notes}` });
  }

  job.lines.push({ kind: 'divider' });
  if (ticket.notes) {
    job.lines.push({ kind: 'text', text: `Note: ${ticket.notes}` });
  }
  job.lines.push({ kind: 'newline' });
  job.lines.push({ kind: 'cut' });
  return job;
}
