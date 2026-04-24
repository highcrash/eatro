export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  ingredientId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    purchaseUnit?: string | null;
    purchaseUnitQty?: number | null;
    currentStock?: number | null;
    packSize?: string | null;
    brandName?: string | null;
  };
}

export interface PurchaseOrder {
  id: string;
  branchId: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  orderedAt: Date | null;
  expectedAt: Date | null;
  receivedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Receipt-level adjustments captured at delivery time. */
  receiptDiscount?: number;
  receiptDiscountReason?: string | null;
  receiptExtraFees?: ReceiptExtraFee[] | null;
  supplier?: { id: string; name: string };
  createdBy?: { id: string; name: string };
  items: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderDto {
  supplierId: string;
  notes?: string;
  expectedAt?: string;
  items: {
    ingredientId: string;
    quantityOrdered: number;
    unitCost: number;
    unit?: string;
  }[];
}

export interface UpdatePurchaseOrderDto {
  supplierId?: string;
  notes?: string;
  expectedAt?: string;
}

/** A receipt-level extra fee captured at delivery (delivery charge,
 *  labour cost, packaging, etc.). Amount is in paisa. */
export interface ReceiptExtraFee {
  label: string;
  amount: number;
}

export interface ReceiveGoodsDto {
  items: {
    purchaseOrderItemId: string;
    quantityReceived: number;
    unitPrice?: number; // in paisa — if provided, updates ingredient cost
    makingDate?: string;
    expiryDate?: string;
    ingredientIdOverride?: string; // receive as a different variant of the same parent
  }[];
  /** Extra items not in the original PO (supplier sent additional products) */
  additionalItems?: {
    ingredientId: string;
    quantityReceived: number;
    unitPrice?: number; // in paisa
    /** Override the receive-side unit. Used when the ingredient has no
     *  purchaseUnit set and the cashier wants to receive in an alternative
     *  stock-compatible unit (e.g. 500 G for a KG-stocked ingredient). */
    unit?: string;
  }[];
  notes?: string;
  /** Close the PO to RECEIVED even when some items are only partially
   *  received. Useful when the supplier won't deliver the rest. */
  closePartial?: boolean;
  /** Flat discount the supplier offered on the whole shipment, in paisa.
   *  Subtracted from the supplier ledger total. */
  receiptDiscount?: number;
  /** Optional reason / note for the discount. Displayed in the ledger. */
  receiptDiscountReason?: string;
  /** Extra fees added at delivery (delivery, labour, etc.). Each fee is
   *  ADDED to the supplier ledger total. */
  receiptExtraFees?: ReceiptExtraFee[];
}

// ─── Purchase Returns ────────────────────────────────────────────────────────

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface PurchaseReturnItem {
  id: string;
  purchaseReturnId: string;
  ingredientId: string;
  quantity: number;
  unitPrice: number;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    purchaseUnit?: string | null;
    packSize?: string | null;
    brandName?: string | null;
  };
}

export interface PurchaseReturn {
  id: string;
  branchId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: ReturnStatus;
  notes: string | null;
  requestedById: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: PurchaseReturnItem[];
  supplier?: { id: string; name: string };
  requestedBy?: { id: string; name: string };
}

export interface CreateReturnDto {
  items: { ingredientId: string; quantity: number; unitPrice: number }[];
  notes?: string;
}
