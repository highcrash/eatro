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
  | 'VOID';
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
