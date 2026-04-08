import type { AuditFields } from './common';

// ─── Category ─────────────────────────────────────────────────────────────────

export interface MenuCategory extends AuditFields {
  id: string;
  branchId: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  children?: MenuCategory[];
}

// ─── Menu Item ────────────────────────────────────────────────────────────────

export type MenuItemType = 'FOOD' | 'BEVERAGE' | 'MODIFIER';

export interface MenuItem extends AuditFields {
  id: string;
  branchId: string;
  categoryId: string;
  category?: MenuCategory;
  name: string;
  description: string | null;
  type: MenuItemType;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  tags: string | null;
  isAvailable: boolean;
  isCombo: boolean;
  cookingStationId: string | null;
  sortOrder: number;
  comboItems?: ComboItem[];
  linkedItems?: LinkedItem[];
}

// ─── Combo Items ─────────────────────────────────────────────────────────────

export interface ComboItem {
  id: string;
  comboMenuId: string;
  includedItemId: string;
  quantity: number;
  includedItem?: MenuItem;
}

// ─── Linked Items (Free / Complementary) ─────────────────────────────────────

export type LinkedItemType = 'FREE' | 'COMPLEMENTARY';

export interface LinkedItem {
  id: string;
  parentMenuId: string;
  linkedMenuId: string;
  type: LinkedItemType;
  triggerQuantity: number;
  freeQuantity: number;
  linkedMenu?: MenuItem;
}

export interface CreateMenuItemDto {
  categoryId: string;
  name: string;
  description?: string;
  type: MenuItemType;
  price: number;
  costPrice?: number;
  imageUrl?: string;
  tags?: string;
  cookingStationId?: string | null;
}

export interface UpdateMenuItemDto extends Partial<CreateMenuItemDto> {
  isAvailable?: boolean;
  sortOrder?: number;
}

// ─── Table ────────────────────────────────────────────────────────────────────

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING';

export interface DiningTable extends AuditFields {
  id: string;
  branchId: string;
  tableNumber: string;
  capacity: number;
  status: TableStatus;
  floorPlanX: number | null;
  floorPlanY: number | null;
}
