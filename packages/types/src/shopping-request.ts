// Mobile shopping-request feature — types shared between API + admin.
// See `prisma/schema.prisma` for the source-of-truth fields and the
// `ShoppingRequestService` for the approval-time side effects.

export type MismatchReason =
  | 'WASTE'
  | 'MISCALCULATION'
  | 'MISSING_PURCHASE'
  | 'ADJUSTMENT';

export type ShoppingRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Reasons that surface in the mobile picker when physical < software. */
export const SHORTAGE_REASONS: MismatchReason[] = ['WASTE', 'MISCALCULATION'];
/** Reasons that surface in the mobile picker when physical > software. */
export const OVERAGE_REASONS: MismatchReason[] = ['MISSING_PURCHASE', 'ADJUSTMENT'];

export interface ShoppingRequestLine {
  id: string;
  requestId: string;
  ingredientId: string;
  requestedQuantity: number | null;
  physicalCount: number | null;
  softwareCountAtTime: number | null;
  mismatchReason: MismatchReason | null;
  mismatchPhotoUrl: string | null;
  mismatchNotes: string | null;
  unitCostPaisa: number | null;
  supplierId: string | null;
  purchaseOrderId: string | null;
  wasteLogId: string | null;
  adjustmentMovementId: string | null;
  ingredient?: {
    id: string;
    name: string;
    unit: string;
    purchaseUnit: string | null;
    costPerPurchaseUnit: number;
    currentStock: number;
  };
  supplier?: { id: string; name: string } | null;
}

export interface ShoppingRequest {
  id: string;
  branchId: string;
  requestedById: string;
  status: ShoppingRequestStatus;
  notes: string | null;
  approvedById: string | null;
  approvedAt: Date | string | null;
  rejectionReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  requestedBy?: { id: string; name: string; role: string };
  approvedBy?: { id: string; name: string } | null;
  lines: ShoppingRequestLine[];
}

/** One row in the staff-side submit payload. The server snapshots
 *  `softwareCountAtTime` from current Ingredient.currentStock — staff
 *  doesn't send it. */
export interface CreateShoppingRequestLineDto {
  ingredientId: string;
  /** Purchase-unit qty to reorder. Pass null/omit when the row exists
   *  only to flag a mismatch. */
  requestedQuantity?: number | null;
  /** When flagging a mismatch, the staff-counted physical on-hand. */
  physicalCount?: number | null;
  mismatchReason?: MismatchReason | null;
  /** URL returned by POST /upload/image when reason is WASTE. */
  mismatchPhotoUrl?: string | null;
  mismatchNotes?: string | null;
}

export interface CreateShoppingRequestDto {
  notes?: string | null;
  lines: CreateShoppingRequestLineDto[];
}

/** Admin-side line edit. id targets an existing line; supplierId +
 *  unitCostPaisa + requestedQuantity can be tweaked before approval. */
export interface UpdateShoppingRequestLineDto {
  id: string;
  requestedQuantity?: number | null;
  supplierId?: string | null;
  unitCostPaisa?: number | null;
  mismatchReason?: MismatchReason | null;
  mismatchNotes?: string | null;
}

export interface UpdateShoppingRequestDto {
  notes?: string | null;
  lines?: UpdateShoppingRequestLineDto[];
}

export interface RejectShoppingRequestDto {
  reason: string;
}

/** Result of a successful approval — one DRAFT PO id per supplier
 *  group plus the per-mismatch resolution back-pointers so the
 *  admin UI can deep-link to each side effect. */
export interface ApproveShoppingRequestResult {
  request: ShoppingRequest;
  createdPurchaseOrderIds: string[];
  wasteLogIds: string[];
  adjustmentMovementIds: string[];
}

/** Miscalculation report row — surfaces ADJUSTMENT-type stock
 *  movements whose notes were prefixed with "Miscalculation:" by
 *  the shopping-request approval flow. */
export interface MiscalculationReportRow {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  signedQty: number;
  valuePaisa: number;
  count: number;
}

export interface MiscalculationReport {
  from: string;
  to: string;
  rows: MiscalculationReportRow[];
  totalValuePaisa: number;
}
