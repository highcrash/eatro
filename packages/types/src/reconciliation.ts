import type { WasteReason } from './waste';

export interface ReconciliationSheetRow {
  ingredientId: string;
  name: string;
  unit: string;
  category: string | null;
  /** Display-only label so the admin can group variants under their parent.
   *  Null when the ingredient is standalone. */
  parentName: string | null;
  isVariant: boolean;
  currentStock: number;
  costPerUnit: number;
  lastMovementAt: string | null;
  /** True when the ingredient has had any StockMovement inside the
   *  movement window the request asked for. Drives the "moved recently
   *  on top, dormant on bottom" sort that helps the counter speed
   *  through the sheet. */
  hasRecentMovement: boolean;
}

export interface ReconciliationSheet {
  generatedAt: string;
  movementWindowDays: number;
  rows: ReconciliationSheetRow[];
}

export interface ReconciliationRowInput {
  ingredientId: string;
  /** Absolute count from the storeroom (in the ingredient's stock unit),
   *  not a delta. Server diffs against the live currentStock at submit
   *  time so the row is robust to other writes between print and submit. */
  physicalQty: number;
  /** Reason the server should stamp when the variance is negative
   *  (physical < software → WASTE log). Ignored for positive variance. */
  reason: WasteReason;
}

export interface ReconciliationSubmitDto {
  notes?: string;
  rows: ReconciliationRowInput[];
}

export interface ReconciliationRowResult {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  before: number;
  after: number;
  delta: number;
  /** What the server actually wrote: 'waste' for negative deltas,
   *  'adjustment' for positive, 'skipped' when the count matched
   *  software exactly, 'failed' when the per-row write threw. */
  outcome: 'waste' | 'adjustment' | 'skipped' | 'failed';
  /** unitCostPaisa × |delta| — the money value of the variance.
   *  0 for skipped rows. */
  valuePaisa: number;
  error?: string;
}

export interface ReconciliationSubmitResult {
  countedRows: number;
  wasteRows: number;
  adjustmentRows: number;
  skippedRows: number;
  failedRows: number;
  totalQtyDown: number;
  totalQtyUp: number;
  valuePaisaDown: number;
  valuePaisaUp: number;
  rows: ReconciliationRowResult[];
}
