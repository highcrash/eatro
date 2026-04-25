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
