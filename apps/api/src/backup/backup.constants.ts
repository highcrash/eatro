/**
 * Models backed up and restored.
 *
 * ORDER MATTERS for restore: parents MUST be inserted before children.
 * Self-referential tables (parentId) are handled row-level: roots (parentId=null)
 * insert first, then descendants.
 *
 * backup_records and backup_schedule are intentionally excluded so a restore
 * never wipes the admin's backup history or schedule config.
 *
 * license_records and update_records are ALSO excluded on purpose —
 * license proof is tied to this install's machine/domain, so restoring
 * it into a different install would refuse to verify. Update history is
 * local per-install too. These survive the restore untouched.
 *
 * idempotency_records is a transient cache (24h TTL); never worth
 * backing up.
 */
export const BACKUP_MODELS: readonly { accessor: string; table: string; hasSelfRef?: boolean }[] = [
  // Tier 0 — system singletons
  { accessor: 'systemConfig', table: 'system_config' },

  // Tier 1 — root
  { accessor: 'branch', table: 'branches' },

  // Tier 2 — branch-owned singletons and people
  // CustomRole must be inserted before Staff so the FK (staff.customRoleId
  // → custom_roles.id) resolves on restore when staff rows reference it.
  { accessor: 'customRole', table: 'custom_roles' },
  { accessor: 'staff', table: 'staff' },
  { accessor: 'branchSetting', table: 'branch_settings' },
  { accessor: 'websiteContent', table: 'website_content' },
  { accessor: 'customer', table: 'customers' },
  { accessor: 'diningTable', table: 'dining_tables' },
  { accessor: 'cookingStation', table: 'cooking_stations' },
  { accessor: 'unitConversion', table: 'unit_conversions' },
  { accessor: 'customUnit', table: 'custom_units' },
  { accessor: 'account', table: 'accounts' },
  { accessor: 'supplier', table: 'suppliers' },
  { accessor: 'device', table: 'devices' },

  // Tier 3 — payment config (depends on branch + account)
  { accessor: 'paymentMethodConfig', table: 'payment_method_configs' },
  { accessor: 'paymentOption', table: 'payment_options' },

  // Tier 4 — inventory & menu catalogs (self-ref handled in service)
  { accessor: 'ingredient', table: 'ingredients', hasSelfRef: true },
  { accessor: 'ingredientSupplier', table: 'ingredient_suppliers' },
  { accessor: 'menuCategory', table: 'menu_categories', hasSelfRef: true },
  { accessor: 'menuItem', table: 'menu_items' },
  { accessor: 'comboItem', table: 'combo_items' },
  { accessor: 'linkedItem', table: 'linked_items' },
  { accessor: 'recipe', table: 'recipes' },
  { accessor: 'recipeItem', table: 'recipe_items' },

  // Tier 5 — pre-ready
  { accessor: 'preReadyItem', table: 'pre_ready_items' },
  { accessor: 'preReadyRecipe', table: 'pre_ready_recipes' },
  { accessor: 'preReadyRecipeItem', table: 'pre_ready_recipe_items' },
  { accessor: 'productionOrder', table: 'production_orders' },
  { accessor: 'preReadyBatch', table: 'pre_ready_batches' },

  // Tier 6 — purchasing & stock
  { accessor: 'purchaseOrder', table: 'purchase_orders' },
  { accessor: 'purchaseOrderItem', table: 'purchase_order_items' },
  { accessor: 'purchaseReturn', table: 'purchase_returns' },
  { accessor: 'purchaseReturnItem', table: 'purchase_return_items' },
  { accessor: 'stockMovement', table: 'stock_movements' },
  { accessor: 'supplierPayment', table: 'supplier_payments' },
  { accessor: 'wasteLog', table: 'waste_logs' },

  // Tier 7 — discounts & reservation
  { accessor: 'discount', table: 'discounts' },
  { accessor: 'coupon', table: 'coupons' },
  { accessor: 'menuItemDiscount', table: 'menu_item_discounts' },
  { accessor: 'reservation', table: 'reservations' },

  // Tier 8 — orders (depend on menu, tables, customers, staff, coupons/discounts)
  { accessor: 'order', table: 'orders' },
  { accessor: 'orderItem', table: 'order_items' },
  { accessor: 'orderPayment', table: 'order_payments' },
  { accessor: 'review', table: 'reviews' },

  // Tier 9 — HR (depend on staff)
  { accessor: 'workPeriod', table: 'work_periods' },
  { accessor: 'attendance', table: 'attendance' },
  { accessor: 'payroll', table: 'payrolls' },
  { accessor: 'payrollPayment', table: 'payroll_payments' },
  { accessor: 'leaveApplication', table: 'leave_applications' },

  // Tier 10 — accounting (depend on accounts + staff)
  { accessor: 'accountTransaction', table: 'account_transactions' },
  { accessor: 'expense', table: 'expenses' },

  // Tier 11 — communications. sms_templates is branch-scoped catalog,
  // sms_logs is the outbound history (campaigns, payment receipts,
  // OTPs). Both survive round-trips so restoring on a new install
  // re-creates the admin's saved templates + full send history.
  { accessor: 'smsTemplate', table: 'sms_templates' },
  { accessor: 'smsLog', table: 'sms_logs' },

  // Tier 12 — NBR Mushak compliance (Bangladesh VAT). Sequence + 6.3
  // invoices + 6.8 credit/debit notes. Back up AFTER orders (FK) and
  // AFTER staff (MushakNote.issuedById). These rows are legally archival
  // and must round-trip faithfully on restore.
  { accessor: 'mushakSequence', table: 'mushak_sequences' },
  { accessor: 'mushakInvoice', table: 'mushak_invoices' },
  { accessor: 'mushakNote', table: 'mushak_notes' },
];

export const BACKUP_FILE_VERSION = 1;
