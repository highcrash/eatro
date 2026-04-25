import type { AuditFields, MoneyAmount } from './common';

// ─── Order Types & Status ─────────────────────────────────────────────────────

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'PAID'
  | 'VOID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';
export type PaymentMethod = string; // Dynamic — configured per branch via PaymentMethodConfig
export type KitchenTicketStatus = 'NEW' | 'PENDING_APPROVAL' | 'ACKNOWLEDGED' | 'PREPARING' | 'DONE' | 'RECALLED';

// ─── Order ────────────────────────────────────────────────────────────────────

export interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: MoneyAmount;
  totalPrice: MoneyAmount;
  notes: string | null;
  kitchenStatus: KitchenTicketStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedById: string | null;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  method: Exclude<PaymentMethod, 'SPLIT'>;
  amount: MoneyAmount;
  reference: string | null;
  createdAt: Date;
}

export interface Order extends AuditFields {
  id: string;
  orderNumber: string;
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  type: OrderType;
  status: OrderStatus;
  items: OrderItem[];
  payments?: OrderPayment[];
  subtotal: MoneyAmount;
  taxAmount: MoneyAmount;
  discountAmount: MoneyAmount;
  totalAmount: MoneyAmount;
  /** Signed paisa delta applied by the auto-round-to-taka pass. */
  roundAdjustment?: MoneyAmount;
  notes: string | null;
  cashierId: string;
  cashierName: string;
  waiterId: string | null;
  guestCount: number;
  billRequested: boolean;
  paymentMethod: PaymentMethod | null;
  paidAt: Date | null;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateOrderItemDto {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface CreateOrderDto {
  tableId?: string;
  waiterId?: string;
  customerId?: string;
  type: OrderType;
  items: CreateOrderItemDto[];
  notes?: string;
  guestCount?: number;
}

export interface AddOrderItemDto {
  menuItemId: string;
  quantity: number;
  notes?: string;
}

export interface ProcessPaymentDto {
  method: PaymentMethod;
  amount: MoneyAmount;
  splits?: Array<{
    method: Exclude<PaymentMethod, 'SPLIT'>;
    amount: MoneyAmount;
    reference?: string;
  }>;
}

/**
 * Replace the payment method on an already-PAID order. Used when a cashier
 * mistakenly tapped CASH instead of bKash, or POS card instead of cash.
 * The server reverses the existing OrderPayment account effects, deletes
 * those rows, creates new rows for the corrected method, and re-applies
 * the SALE deltas to the linked accounts. Total amount is preserved —
 * only the method (or split breakdown) changes.
 */
export interface CorrectPaymentDto {
  method: PaymentMethod;
  splits?: Array<{
    method: Exclude<PaymentMethod, 'SPLIT'>;
    amount: MoneyAmount;
    reference?: string;
  }>;
  /** Approver PIN (reused from void / refund approval pattern). */
  approverPin?: string;
  /** Approver staff id; falls back to current user when omitted. */
  approverId?: string;
  /** Optional note saved on the new OrderPayment.reference for audit. */
  reason?: string;
}

export interface VoidOrderDto {
  reason: string;
  approverId: string;
}

export interface VoidOrderItemDto {
  reason: string;
  approverId: string;
  logAsWaste?: boolean;
  wasteReason?: string; // WasteReason enum value
}

// ─── NBR Mushak (Bangladesh VAT) ─────────────────────────────────────────────

export type RefundReason =
  | 'CUSTOMER_RETURN'
  | 'PRICING_ERROR'
  | 'DUPLICATE'
  | 'DAMAGED'
  | 'OTHER';

export type MushakNoteType = 'CREDIT' | 'DEBIT';

export interface RefundOrderDto {
  /** When omitted/empty, refunds the entire remaining paid order. */
  itemIds?: string[];
  reason: RefundReason;
  reasonText?: string;
  /** Approver PIN (reused from the existing void-approval pattern). */
  approverPin?: string;
  /** Approver staff id; if absent the server looks up by PIN on branch. */
  approverId?: string;
}

export interface MushakInvoice {
  id: string;
  branchId: string;
  orderId: string;
  serial: string;
  fiscalYear: string;
  branchCode: string;
  seq: number;
  formVersion: '6.3';
  issuedAt: Date | string;
  buyerName: string | null;
  buyerPhone: string | null;
  buyerAddress: string | null;
  buyerBin: string | null;
  subtotalExclVat: MoneyAmount;
  sdAmount: MoneyAmount;
  vatAmount: MoneyAmount;
  totalInclVat: MoneyAmount;
  /** Frozen snapshot JSON — shape matches MushakSnapshot in @restora/utils. */
  snapshot: unknown;
}

export interface MushakNote {
  id: string;
  branchId: string;
  invoiceId: string;
  orderId: string;
  serial: string;
  fiscalYear: string;
  branchCode: string;
  seq: number;
  formVersion: '6.8';
  noteType: MushakNoteType;
  reasonCode: RefundReason;
  reasonText: string | null;
  issuedAt: Date | string;
  issuedById: string;
  subtotalExclVat: MoneyAmount;
  sdAmount: MoneyAmount;
  vatAmount: MoneyAmount;
  totalInclVat: MoneyAmount;
  refundedItemIds: string[];
  snapshot: unknown;
}

// ─── Items-Sold report ───────────────────────────────────────────────────────

/**
 * One line in the Items-Sold report — items with the same name AND unit price
 * are aggregated into a single row. Different unit prices (discounted line
 * vs full price) get their own rows so the print "qty × name × unit = total"
 * is unambiguous.
 */
export interface ItemsSoldRow {
  menuItemId: string;
  name: string;
  unitPrice: MoneyAmount;
  quantity: number;
  totalRevenue: MoneyAmount;
}

export interface ItemsSoldReport {
  from: string;
  to: string;
  rows: ItemsSoldRow[];
  /** Grand totals across all rows in the period. */
  totals: {
    quantity: number;
    revenue: MoneyAmount;
  };
}

// ─── Performance Report ──────────────────────────────────────────────────────

/**
 * Per-menu-item performance for a date range. COGS is sum of
 * recipe.items[i].quantity × ingredient.costPerUnit (with variant-fallback
 * when the parent has no cost) × orderItem.quantity. Items with no recipe
 * report cogs=0 and marginPct=null.
 */
export interface PerformanceItemRow {
  menuItemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  quantity: number;
  revenue: MoneyAmount;
  cogs: MoneyAmount;
  grossProfit: MoneyAmount;
  /** null when revenue is 0 or cogs is 0 (no recipe). */
  marginPct: number | null;
}

export interface PerformanceCategoryRow {
  categoryId: string;
  categoryName: string;
  quantity: number;
  revenue: MoneyAmount;
  cogs: MoneyAmount;
  grossProfit: MoneyAmount;
  marginPct: number | null;
}

/**
 * Inventory price-volatility row — surfaces ingredients whose
 * PurchaseOrderItem.unitCost has shifted across deliveries in the period.
 * Filtered to ≥ 2 distinct prices to keep the noise low.
 */
export interface InventoryPriceVolatilityRow {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  distinctPrices: number;
  minUnitCost: MoneyAmount;
  maxUnitCost: MoneyAmount;
  avgUnitCost: MoneyAmount;
  latestUnitCost: MoneyAmount;
  deliveries: number;
}

export interface PerformanceReport {
  from: string;
  to: string;
  items: PerformanceItemRow[];
  categories: PerformanceCategoryRow[];
  inventoryVolatility: InventoryPriceVolatilityRow[];
  /** Suggested cost-margin% derived from average margin across items
   *  with cogs > 0 (skips menu items without a recipe). Used by the
   *  admin Settings page to pre-fill the custom-menu margin field. */
  suggestedCustomMenuMargin: number | null;
}

/** Row rendered in the admin Mushak register — interleaved 6.3 + 6.8. */
export interface MushakRegisterRow {
  kind: 'INVOICE' | 'NOTE';
  id: string;
  serial: string;
  issuedAt: Date | string;
  buyerName: string | null;
  subtotalExclVat: MoneyAmount;
  sdAmount: MoneyAmount;
  vatAmount: MoneyAmount;
  totalInclVat: MoneyAmount;
  /** Only set for NOTE rows. */
  reasonCode?: RefundReason | null;
  linkedInvoiceSerial?: string | null;
}
