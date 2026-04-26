export type SupplierCategory = 'MEAT' | 'FISH' | 'VEGETABLES' | 'DAIRY' | 'SPICES' | 'CLEANING' | 'PACKAGING' | 'BEVERAGE' | 'GENERAL';
export type BuiltinStockUnit =
  | 'KG' | 'G' | 'L' | 'ML' | 'PCS' | 'DOZEN' | 'BOX'
  | 'PACKET' | 'PACK' | 'BOTTLE' | 'BAG' | 'BUNDLE' | 'CAN' | 'JAR' | 'TIN' | 'CARTON';
// Using `string & {}` keeps autocomplete for builtins while still allowing
// admin-defined custom units (registered via POST /custom-units) as values.
// eslint-disable-next-line @typescript-eslint/ban-types
export type StockUnit = BuiltinStockUnit | (string & {});

export interface CustomUnit {
  id: string;
  branchId: string;
  code: string;
  label: string;
  createdAt: string;
  deletedAt: string | null;
}
export type StockMovementType = 'PURCHASE' | 'SALE' | 'VOID_RETURN' | 'ADJUSTMENT' | 'WASTE';
export type IngredientCategory = 'RAW' | 'CLEANING' | 'PACKAGED' | 'SPICE' | 'DAIRY' | 'BEVERAGE' | 'SUPPLY' | 'OTHER';

export interface Supplier {
  id: string;
  branchId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  category: SupplierCategory;
  totalDue: number;
  isActive: boolean;
  visibleToCashier: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  payments?: SupplierPayment[];
}

export interface Ingredient {
  id: string;
  branchId: string;
  supplierId: string | null;
  name: string;
  itemCode: string | null;
  category: IngredientCategory;
  unit: StockUnit;
  purchaseUnit: string | null;
  purchaseUnitQty: number;
  currentStock: number;
  minimumStock: number;
  costPerUnit: number;
  costPerPurchaseUnit: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  // Variant support
  parentId: string | null;
  hasVariants: boolean;
  brandName: string | null;
  packSize: string | null;
  piecesPerPack: number | null;
  sku: string | null;
  imageUrl: string | null;
  showOnWebsite: boolean;
  /** Optional alias rendered to customers on the website menu in
   *  place of `name` (e.g. internal "Garlic Powder" → "Aromatic
   *  Garlic"). null = fall back to `name`. Server-side fallback is
   *  applied by the public menu endpoint, so callers reading
   *  `ingredient.name` from public payloads already see the right
   *  thing — this field is here for the admin form to edit. */
  websiteDisplayName?: string | null;
  variants?: Ingredient[];
  parent?: Ingredient | null;
  // Relations
  supplier?: Supplier | null;
  suppliers?: { id: string; ingredientId: string; supplierId: string; supplier: { id: string; name: string } }[];
}

export interface RecipeItem {
  id: string;
  recipeId: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  ingredient?: Ingredient;
}

export interface Recipe {
  id: string;
  menuItemId: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: RecipeItem[];
}

export interface SupplierPayment {
  id: string;
  branchId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  amount: number;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  paidById: string;
  createdAt: Date;
  paidBy?: { id: string; name: string };
}

/** Manual ledger correction (Owner/Manager only). Pure ledger-only:
 *  adjusts Supplier.totalDue and shows up in the supplier ledger view
 *  as its own line. Never touches a cash/bank account or creates an
 *  Expense mirror. Negative amount reduces debt, positive amount
 *  increases it. */
export interface SupplierAdjustment {
  id: string;
  branchId: string;
  supplierId: string;
  amount: number;
  reason: string;
  recordedById: string;
  createdAt: Date;
  recordedBy?: { id: string; name: string };
}

export interface RecordSupplierAdjustmentDto {
  /** Signed: negative reduces totalDue, positive increases. */
  amount: number;
  reason: string;
}

export interface StockMovement {
  id: string;
  branchId: string;
  ingredientId: string;
  type: StockMovementType;
  quantity: number;
  notes: string | null;
  orderId: string | null;
  staffId: string | null;
  createdAt: Date;
  ingredient?: Ingredient;
}

// DTOs
export interface CreateSupplierDto {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  category?: SupplierCategory;
  openingBalance?: number;
}

export interface UpdateSupplierDto {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive?: boolean;
  visibleToCashier?: boolean;
  category?: SupplierCategory;
}

export interface CreateIngredientDto {
  name: string;
  unit: StockUnit;
  minimumStock?: number;
  costPerUnit?: number;
  supplierId?: string;
  itemCode?: string;
  category?: IngredientCategory;
  purchaseUnit?: string;
  purchaseUnitQty?: number;
  costPerPurchaseUnit?: number;
  /** Customer-facing alias rendered on the website menu in place of
   *  `name`. Empty / null = fall back to the real name. */
  websiteDisplayName?: string | null;
}

export interface UpdateIngredientDto {
  name?: string;
  unit?: StockUnit;
  minimumStock?: number;
  costPerUnit?: number;
  supplierId?: string;
  isActive?: boolean;
  itemCode?: string;
  category?: IngredientCategory;
  purchaseUnit?: string;
  purchaseUnitQty?: number;
  costPerPurchaseUnit?: number;
  /** See CreateIngredientDto.websiteDisplayName. */
  websiteDisplayName?: string | null;
}

export interface CreateVariantDto {
  brandName: string;
  packSize?: string;
  piecesPerPack?: number;   // 1 PACK = X PCS (inherits parent's unit)
  sku?: string;
  costPerPurchaseUnit?: number;
  supplierId?: string;
}

export interface AdjustStockDto {
  quantity: number;   // positive = add, negative = remove
  type: 'ADJUSTMENT' | 'WASTE' | 'PURCHASE' | 'OPERATIONAL_USE';
  notes?: string;
}

/** Single row of the Supplies report — one per SUPPLY-category
 *  ingredient, scoped to a date window. Used by Reports → Supplies
 *  and the Inventory page's "Used (last 30d)" column. */
export interface SuppliesReportRow {
  ingredientId: string;
  name: string;
  unit: string;
  /** Stock on hand right now (snapshot at request time). */
  currentStock: number;
  /** Cost per stock unit, snapshotted from the ingredient. */
  costPerUnit: number;
  /** On-hand value = currentStock × costPerUnit. */
  onHandValue: number;
  /** Units purchased in the window (sum of PURCHASE movements). */
  purchasedQty: number;
  /** Total spend in the window (purchasedQty × costPerUnit). */
  purchasedCost: number;
  /** Units consumed in the window (sum of OPERATIONAL_USE). */
  usedQty: number;
  /** Units written off in the window (sum of WASTE). */
  wastedQty: number;
  /** Trailing 30-day burn rate per day, used to project days-of-cover. */
  avgDailyUsage: number;
  /** Estimated days of cover at the trailing burn rate. null when
   *  there's no recent usage to extrapolate from. */
  daysOfCover: number | null;
}

export interface SuppliesReportResponse {
  rows: SuppliesReportRow[];
  totals: {
    purchasedCost: number;
    usedQty: number;
    onHandValue: number;
  };
  windowFrom: string;
  windowTo: string;
}

export interface UpsertRecipeDto {
  notes?: string;
  items: { ingredientId: string; quantity: number; unit?: string }[];
}

export interface CreateSupplierPaymentDto {
  supplierId: string;
  purchaseOrderId?: string;
  amount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
}
