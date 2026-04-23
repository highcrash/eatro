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
