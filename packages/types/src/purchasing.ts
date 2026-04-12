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
  }[];
  notes?: string;
}

// ─── Purchase Returns ────────────────────────────────────────────────────────

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface PurchaseReturnItem {
  id: string;
  purchaseReturnId: string;
  ingredientId: string;
  quantity: number;
  unitPrice: number;
  ingredient?: { id: string; name: string; unit: string };
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
