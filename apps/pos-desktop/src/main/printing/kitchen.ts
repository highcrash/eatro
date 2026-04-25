import type { KitchenTicketInput } from '@restora/utils';
import log from 'electron-log';
import { getPrinters } from '../config/store';
import type { PrinterSlot } from '../config/store';
import { sendThermalJob, type ThermalJob } from './escpos';
import { groupTicketBySection, type SectionGroup } from './sections';

/**
 * Kitchen ticket entry point. Fans the ticket out to:
 *   1. Each kitchen section's configured printer (or the default
 *      kitchen slot if a section has no printer), one KOT per section
 *      containing only that section's items.
 *   2. The bill / cash printer, as separate KOT copies per section, so
 *      the cashier has a paper trail of what went to each station.
 *
 * If no sections are configured or none of the ticket's items can be
 * matched to a section, the ticket falls back to a single KOT printed
 * to the default kitchen slot + the bill slot.
 */
export async function printKitchenTicket(ticket: KitchenTicketInput): Promise<void> {
  const cfg = await getPrinters();
  const kitchenSlot = cfg.kitchen;
  const billSlot = cfg.bill;

  const activeTicket: KitchenTicketInput = {
    ...ticket,
    items: (ticket.items ?? []).filter((i) => !i.voidedAt),
  };
  if (activeTicket.items.length === 0) return;

  const groups = groupTicketBySection(activeTicket);
  const errors: string[] = [];

  // Nothing to do if every slot is disabled.
  if (kitchenSlot.mode === 'disabled' && billSlot.mode === 'disabled' && groups.every((g) => !g.slot)) {
    throw new Error('No printer is configured for kitchen sections, the default kitchen slot, or the bill slot.');
  }

  // Multiple printers run in parallel — receipt printers aren't
  // serialized at the driver level and a slow one shouldn't block the rest.
  const sends: Promise<void>[] = [];

  for (const group of groups) {
    const sectionTicket: KitchenTicketInput = { ...activeTicket, items: group.items, sectionName: group.stationName };

    // Section printer (or default kitchen slot if the section doesn't
    // have one configured).
    const primary = group.slot ?? (kitchenSlot.mode !== 'disabled' ? kitchenSlot : null);
    if (primary) {
      sends.push(
        sendThermalJob(primary, buildKitchenJob(sectionTicket)).catch((err) => {
          const label = group.stationName ?? 'kitchen';
          errors.push(`${label}: ${(err as Error).message}`);
        }),
      );
    }

    // Copy on the bill/cash printer — one per section.
    if (billSlot.mode !== 'disabled') {
      sends.push(
        sendThermalJob(billSlot, buildKitchenJob(sectionTicket)).catch((err) => {
          errors.push(`bill-copy ${group.stationName ?? 'kitchen'}: ${(err as Error).message}`);
        }),
      );
    }
  }

  await Promise.all(sends);

  if (errors.length > 0) {
    const msg = `Some KOT prints failed: ${errors.join(' | ')}`;
    log.warn(`[kitchen] ${msg}`);
    // Throw only if EVERY send failed — otherwise the partial success is
    // still useful and the cashier can check diagnostics.
    if (errors.length === sends.length) throw new Error(msg);
  }
}

function buildKitchenJob(ticket: KitchenTicketInput): ThermalJob {
  const job: ThermalJob = { lines: [] };
  const createdAt = new Date(ticket.createdAt);
  const destination = ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.type;
  const activeItems = (ticket.items ?? []).filter((i) => !i.voidedAt);
  const sectionHeader = ticket.sectionName ?? 'Kitchen Order';

  // Section + "New Order" + date/time stay at normal size; the destination
  // (Table N) and every item line go double-width/double-height so the
  // kitchen can read the ticket across the pass. Mirrors the HTML
  // template's 28-32px item / destination bump.
  job.lines.push({ kind: 'align-center' });
  job.lines.push({ kind: 'text', text: sectionHeader, bold: true });
  job.lines.push({ kind: 'text', text: 'New Order' });
  job.lines.push({ kind: 'text', text: `${createdAt.toLocaleDateString()}  ${createdAt.toLocaleTimeString()}` });
  job.lines.push({ kind: 'text', text: destination, bold: true, size: 'large' });
  job.lines.push({ kind: 'divider' });

  job.lines.push({ kind: 'align-left' });
  for (const it of activeItems) {
    job.lines.push({ kind: 'text', text: `${it.quantity}-: ${it.menuItemName}`, bold: true, size: 'large' });
    // Print selected addons under the item.
    const addons = (it.selectedAddons ?? it.addons?.map((a) => a.addonName) ?? []).filter((n): n is string => !!n);
    for (const name of addons) {
      job.lines.push({ kind: 'text', text: `   + ${name}`, bold: true });
    }
    // Print "no garlic" mods in bold so the chef can't miss them.
    const removed = (it.removedIngredients ?? it.modifications?.removedNames ?? []).filter((n): n is string => !!n);
    for (const name of removed) {
      job.lines.push({ kind: 'text', text: `   -- NO ${name.toUpperCase()}`, bold: true });
    }
    if (it.notes) job.lines.push({ kind: 'text', text: `   -> ${it.notes}` });
    job.lines.push({ kind: 'divider' });
  }

  if (ticket.notes) {
    job.lines.push({ kind: 'text', text: `Notes: ${ticket.notes}` });
  }
  job.lines.push({ kind: 'newline' });
  job.lines.push({ kind: 'cut' });
  return job;
}

// Silence unused-var; SectionGroup is re-exported in case future callers
// want the pre-grouped result.
void (null as unknown as SectionGroup);
void (null as unknown as PrinterSlot);
