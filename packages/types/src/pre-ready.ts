export type ProductionStatus = 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'WASTED' | 'CANCELLED';

export interface PreReadyItem {
  id: string;
  branchId: string;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  /** Auto-calculated cost per produced unit (paisa). */
  costPerUnit: number;
  isActive: boolean;
  createdAt: Date;
  recipe?: PreReadyRecipe | null;
  batches?: PreReadyBatch[];
}

export interface PreReadyRecipe {
  id: string;
  preReadyItemId: string;
  yieldQuantity: number;
  yieldUnit: string;
  notes: string | null;
  items: PreReadyRecipeItem[];
}

export interface PreReadyRecipeItem {
  id: string;
  recipeId: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  ingredient?: { id: string; name: string; unit: string };
}

export interface ProductionOrder {
  id: string;
  branchId: string;
  preReadyItemId: string;
  quantity: number;
  status: ProductionStatus;
  requestedById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  preReadyItem?: { id: string; name: string; unit: string };
  requestedBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
}

export interface PreReadyBatch {
  id: string;
  branchId: string;
  preReadyItemId: string;
  quantity: number;
  remainingQty: number;
  makingDate: string;
  expiryDate: string;
  createdAt: Date;
}

export interface CreatePreReadyItemDto {
  name: string;
  unit: string;
  minimumStock?: number;
}

export interface UpsertPreReadyRecipeDto {
  yieldQuantity: number;
  yieldUnit: string;
  notes?: string;
  items: { ingredientId: string; quantity: number; unit?: string }[];
}

export interface CreateProductionOrderDto {
  preReadyItemId: string;
  quantity: number;
  notes?: string;
}

export interface CompleteProductionDto {
  makingDate: string;
  expiryDate: string;
}

/** One row in the bulk pre-ready reconciliation sheet. The cashier or
 *  chef physically counts each item's on-hand stock and types it in;
 *  the server computes a delta against the live `currentStock` and
 *  routes positive deltas as production batches and negative deltas
 *  as wastage. Mirrors the Stock Reconciliation workflow used for
 *  raw ingredients. */
export interface BulkPreReadyReconcileRow {
  preReadyItemId: string;
  physicalQty: number;
}

/** Bulk reconcile request body. Single making/expiry date applies to
 *  every row that lands as a production batch (admin sets it once at
 *  the top of the sheet — saves typing in a rush). Optional notes
 *  attach to both the production batch records and the wastage log
 *  rows for traceability. */
export interface BulkPreReadyReconcileDto {
  rows: BulkPreReadyReconcileRow[];
  makingDate: string;
  expiryDate: string;
  notes?: string;
}

export type BulkPreReadyReconcileOutcome = 'produced' | 'wasted' | 'skipped' | 'failed';

export interface BulkPreReadyReconcileRowResult {
  preReadyItemId: string;
  preReadyItemName: string;
  unit: string;
  before: number;
  after: number;
  /** Signed delta: positive = produced, negative = wasted, 0 = matched. */
  delta: number;
  outcome: BulkPreReadyReconcileOutcome;
  /** Paisa value of the delta (delta × costPerUnit). Wastage is shown
   *  as a positive number — caller already knows it's a loss from the
   *  outcome field. */
  valuePaisa: number;
  error?: string;
}

export interface BulkPreReadyReconcileResult {
  countedRows: number;
  producedRows: number;
  wastedRows: number;
  skippedRows: number;
  failedRows: number;
  totalQtyProduced: number;
  totalQtyWasted: number;
  valuePaisaProduced: number;
  valuePaisaWasted: number;
  rows: BulkPreReadyReconcileRowResult[];
}
