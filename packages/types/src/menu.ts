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
  websiteVisible: boolean;
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
  pieces: string | null;
  prepTime: string | null;
  spiceLevel: string | null;
  websiteVisible: boolean;
  /** True when the item was created via POS Customised Menu. */
  isCustom?: boolean;
  /** Parent FK when this row is a sellable variant. Null on
   *  standalone items and on parent shells. */
  variantParentId?: string | null;
  /** True when this row is a non-sellable picker shell. */
  isVariantParent?: boolean;
  /** Sellable children — populated on parent rows in admin / POS
   *  pickers. Empty on standalone items and on variants themselves. */
  variants?: MenuItem[];
  /** Optional back-reference for child rows. */
  variantParent?: MenuItem | null;
  /** True when this row is an addon (Extra Patty, Cheese Sauce, etc).
   *  Filtered from main grid + website / QR feed. */
  isAddon?: boolean;
  /** Addon groups attached to this menu item. Populated on parents. */
  addonGroups?: MenuItemAddonGroup[];
  comboItems?: ComboItem[];
  linkedItems?: LinkedItem[];
}

// ─── Addons (Phase 3) ────────────────────────────────────────────────────────

export interface MenuItemAddonOption {
  id: string;
  groupId: string;
  addonItemId: string;
  sortOrder: number;
  /** Hydrated addon detail when available (admin + POS pickers). */
  addon?: MenuItem;
}

export interface MenuItemAddonGroup {
  id: string;
  branchId: string;
  menuItemId: string;
  name: string;
  /** Customer must pick at least this many. 0 = optional group. */
  minPicks: number;
  /** Customer can pick at most this many. */
  maxPicks: number;
  sortOrder: number;
  options: MenuItemAddonOption[];
}

export interface UpsertAddonGroupDto {
  name: string;
  minPicks: number;
  maxPicks: number;
  sortOrder?: number;
  /** Addon MenuItem IDs in the order they should appear. Server
   *  validates each row is `isAddon=true` on the same branch. */
  addonItemIds: string[];
}

/** Snapshot stored on OrderItem.addons. Frozen at order time. */
export interface OrderItemAddon {
  groupId: string;
  groupName: string;
  addonItemId: string;
  addonName: string;
  /** Per-unit price snapshotted at order time, in paisa. */
  price: number;
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
  /** When set, this new item is a child variant of the given parent. */
  variantParentId?: string | null;
  /** When true, this new item is a non-sellable picker shell. Server
   *  rejects orderItem.create against rows with this flag set. */
  isVariantParent?: boolean;
  /** When true, this new item is an addon (selectable only via an
   *  addon group on a parent menu item). */
  isAddon?: boolean;
}

export interface UpdateMenuItemDto extends Partial<CreateMenuItemDto> {
  isAvailable?: boolean;
  sortOrder?: number;
  pieces?: string | null;
  prepTime?: string | null;
  spiceLevel?: string | null;
  websiteVisible?: boolean;
}

/** Reorder / rename a parent's child variants in one call. */
export interface SetVariantsDto {
  variantIds: string[];
}

/**
 * POS Customised Menu — cashier-side payload for one-shot custom dishes
 * that aren't on the standard menu. Server creates a hidden MenuItem in
 * the auto-seeded "Custom Orders" category, attaches the recipe so stock
 * deducts via the existing pipeline, and validates sellingPrice against
 * branch margin policy.
 */
export interface CreateCustomMenuDto {
  name: string;
  description?: string;
  /** Selling price in paisa. Server enforces floor / ceiling. */
  sellingPrice: number;
  /** Recipe lines. Server re-merges by (ingredientId, unit). */
  items: { ingredientId: string; quantity: number; unit?: string }[];
  /** OTP token when admin gated createCustomMenu with approval=OTP. */
  actionOtp?: string;
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
