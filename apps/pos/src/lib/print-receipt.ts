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

interface Branding {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  billFooterText?: string | null;
}

interface DesktopReceiptInput {
  brandName: string;
  branchName: string;
  branchAddress?: string;
  branchPhone?: string;
  orderNumber: string;
  tableNumber?: string | null;
  type: string;
  createdAt: string | Date;
  cashierName?: string;
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
  taxAmount?: number;
  totalAmount: number;
  paymentMethod?: string;
  currencySymbol?: string;
  footerText?: string;
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

export function orderToReceiptInput(order: Order, branding: Branding | undefined): DesktopReceiptInput {
  return {
    brandName: branding?.name ?? 'Restora',
    branchName: branding?.name ?? '',
    branchAddress: branding?.address ?? undefined,
    branchPhone: branding?.phone ?? undefined,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber ?? null,
    type: order.type,
    createdAt: order.paidAt ?? order.createdAt ?? new Date().toISOString(),
    cashierName: undefined,
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
    taxAmount: order.taxAmount ? Number(order.taxAmount) : undefined,
    totalAmount: Number(order.totalAmount),
    paymentMethod: order.paymentMethod ?? undefined,
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
  opts: { openCashDrawer?: boolean } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const dp = desktopPrint();
  if (dp?.receipt) {
    return dp.receipt({
      receipt: orderToReceiptInput(order, branding),
      openCashDrawer: opts.openCashDrawer ?? order.paymentMethod === 'CASH',
    });
  }
  window.print();
  return { ok: true };
}
