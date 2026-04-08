export type SupplierCategory = 'MEAT' | 'FISH' | 'VEGETABLES' | 'DAIRY' | 'SPICES' | 'CLEANING' | 'PACKAGING' | 'BEVERAGE' | 'GENERAL';
export type StockUnit = 'KG' | 'G' | 'L' | 'ML' | 'PCS' | 'DOZEN' | 'BOX';
export type StockMovementType = 'PURCHASE' | 'SALE' | 'VOID_RETURN' | 'ADJUSTMENT' | 'WASTE';
export type IngredientCategory = 'RAW' | 'CLEANING' | 'PACKAGED' | 'SPICE' | 'DAIRY' | 'BEVERAGE' | 'OTHER';

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
}

export interface AdjustStockDto {
  quantity: number;   // positive = add, negative = remove
  type: 'ADJUSTMENT' | 'WASTE' | 'PURCHASE';
  notes?: string;
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
