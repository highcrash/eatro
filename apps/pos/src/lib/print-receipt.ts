/**
 * Thin shim that routes receipt prints through the desktop wrapper when
 * available, falling back to the browser's window.print() otherwise.
 *
 * The desktop wrapper ships raw ESC/POS to the configured bill thermal and
 * pops the cash drawer on cash payments — none of which the browser path
 * can do. In the browser we keep the existing behaviour so the web POS is
 * unchanged.
 */
import type { Order } from '@restora/types';
import { shortOrderCode } from '@restora/utils';

interface Branding {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  billFooterText?: string | null;
  billHeaderText?: string | null;
  bin?: string | null;
  mushakVersion?: string | null;
  wifiPass?: string | null;
  logoUrl?: string | null;
  billLogoWidthPct?: number | null;
  taxRate?: number | string | null;
  serviceChargeRate?: number | string | null;
  serviceChargeEnabled?: boolean | null;
  vatEnabled?: boolean | null;
}

interface DesktopReceiptInput {
  brandName: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  bin?: string;
  mushakVersion?: string;
  logoUrl?: string;
  logoWidthPct?: number;
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  cashierName?: string;
  waiterName?: string;
  guestCount?: number;
  wifiPass?: string;
  statusLabel?: string;
  items: Array<{
    quantity: number;
    menuItemName: string;
    unitPrice: number;
    lineTotal: number;
    notes?: string | null;
  }>;
  subtotal: number;
  discountAmount?: number;
  discountName?: string | null;
  serviceChargeAmount?: number;
  serviceChargeRatePct?: number;
  taxAmount?: number;
  taxRatePct?: number;
  roundAdjustment?: number;
  totalAmount: number;
  payments?: Array<{ method: string; amount: number; reference?: string | null }>;
  changeReturned?: number;
  paymentMethod?: string;
  currencySymbol?: string;
  headerText?: string;
  footerText?: string;
  notes?: string;
}

interface DesktopPrintApi {
  receipt?: (args: { receipt: DesktopReceiptInput; openCashDrawer?: boolean }) =>
    Promise<{ ok: true } | { ok: false; message: string }>;
}

function desktopPrint(): DesktopPrintApi | null {
  const w = window as unknown as { desktop?: { print?: DesktopPrintApi } };
  return w.desktop?.print ?? null;
}

/** True when the POS is running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return desktopPrint()?.receipt != null;
}

export function orderToReceiptInput(
  order: Order,
  branding: Branding | undefined,
  opts: { cashReceived?: number } = {},
): DesktopReceiptInput {
  // Split payments from the Order's payments array — this is what lets the
  // thermal receipt show the proper "Payments: -Cash: ... -Card: ..." block.
  const rawPayments = (order.payments ?? []) as Array<{ method: string; amount: number; reference?: string | null }>;
  const total = Number(order.totalAmount);

  // Cash handling: if the cashier captured a "received" amount (i.e. the
  // customer handed over more than the bill), swap the cash payment's
  // stored `amount` for the tendered total — that's what the printed
  // receipt needs to reflect, with the difference going to the RETURNED
  // AMOUNT line. Non-cash payments stay at their applied amounts.
  const cashReceived = opts.cashReceived != null && opts.cashReceived > 0 ? opts.cashReceived : null;
  const payments = rawPayments.length
    ? rawPayments.map((p) => {
        const isCash = String(p.method ?? '').toUpperCase() === 'CASH';
        const applied = Number(p.amount);
        return {
          method: p.method,
          amount: isCash && cashReceived != null ? Math.max(cashReceived, applied) : applied,
          reference: p.reference ?? null,
        };
      })
    : undefined;

  const totalPaid = payments ? payments.reduce((s, p) => s + p.amount, 0) : 0;
  const change = payments && totalPaid > total ? totalPaid - total : 0;

  const taxRatePct = branding?.taxRate != null ? Number(branding.taxRate) : undefined;
  const serviceChargeRatePct = branding?.serviceChargeRate != null ? Number(branding.serviceChargeRate) : undefined;
  const serviceChargeAmount = Number((order as unknown as { serviceChargeAmount?: number }).serviceChargeAmount ?? 0);
  const isPaid = order.status === 'PAID' || (payments?.length ?? 0) > 0;

  return {
    brandName: branding?.name ?? 'Restora',
    branchName: branding?.name ?? '',
    branchAddress: branding?.address ?? undefined,
    branchPhone: branding?.phone ?? undefined,
    bin: branding?.bin ?? undefined,
    mushakVersion: branding?.mushakVersion ?? undefined,
    wifiPass: branding?.wifiPass ?? undefined,
    logoUrl: branding?.logoUrl ?? undefined,
    logoWidthPct: branding?.billLogoWidthPct != null ? Number(branding.billLogoWidthPct) : undefined,
    // Customer-facing prints use the deterministic short code
    // (e.g. "A4K2P9") instead of the verbose ORD-YYYYMMDD-XXXX so
    // the date/sequence isn't leaked on the receipt. The internal
    // POS UI keeps using order.orderNumber for operational lookups.
    orderNumber: shortOrderCode(order.id),
    tableNumber: order.tableNumber ?? null,
    type: order.type,
    createdAt: order.paidAt ?? order.createdAt ?? new Date().toISOString(),
    cashierName: (order as unknown as { cashierName?: string }).cashierName ?? undefined,
    waiterName: (order as unknown as { waiterName?: string; waiter?: { name?: string } }).waiterName
      ?? (order as unknown as { waiter?: { name?: string } }).waiter?.name,
    guestCount: Number((order as unknown as { guestCount?: number }).guestCount ?? 0) || undefined,
    statusLabel: isPaid ? 'Paid BILL' : undefined,
    items: order.items.map((i) => ({
      quantity: Number(i.quantity),
      menuItemName: i.menuItemName,
      unitPrice: Number(i.unitPrice ?? i.totalPrice),
      lineTotal: Number(i.totalPrice),
      notes: i.notes ?? null,
    })),
    subtotal: Number(order.subtotal),
    discountAmount: order.discountAmount ? Number(order.discountAmount) : undefined,
    discountName: (order as unknown as { discountName?: string | null }).discountName ?? null,
    serviceChargeAmount: serviceChargeAmount > 0 ? serviceChargeAmount : undefined,
    serviceChargeRatePct: serviceChargeRatePct != null && Number.isFinite(serviceChargeRatePct) && serviceChargeRatePct > 0 ? serviceChargeRatePct : undefined,
    taxAmount: order.taxAmount ? Number(order.taxAmount) : undefined,
    taxRatePct: Number.isFinite(taxRatePct) ? taxRatePct : undefined,
    // Auto round-to-taka delta (signed paisa). Receipt templates show
    // "Auto Roundup (+X.XX)" / "(-X.XX)" when non-zero.
    roundAdjustment: (order as { roundAdjustment?: number | string }).roundAdjustment
      ? Number((order as { roundAdjustment?: number | string }).roundAdjustment)
      : undefined,
    totalAmount: Number(order.totalAmount),
    payments,
    changeReturned: isPaid ? change : undefined,
    paymentMethod: order.paymentMethod ?? undefined,
    headerText: branding?.billHeaderText ?? undefined,
    footerText: branding?.billFooterText ?? undefined,
  };
}

/**
 * Print a receipt. Returns the async result if it went through the desktop
 * path; returns { ok: true } immediately after firing window.print() in the
 * browser path.
 */
export async function printReceiptSmart(
  order: Order,
  branding: Branding | undefined,
  opts: { openCashDrawer?: boolean; cashReceived?: number } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const dp = desktopPrint();
  if (dp?.receipt) {
    return dp.receipt({
      receipt: orderToReceiptInput(order, branding, { cashReceived: opts.cashReceived }),
      openCashDrawer: opts.openCashDrawer ?? order.paymentMethod === 'CASH',
    });
  }
  window.print();
  return { ok: true };
}
