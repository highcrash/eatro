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
  // Same rationale for SalaryStructure + LeaveRule — Staff has nullable
  // FKs into both, so they must exist before staff rows insert.
  { accessor: 'customRole', table: 'custom_roles' },
  { accessor: 'salaryStructure', table: 'salary_structures' },
  { accessor: 'leaveRule', table: 'leave_rules' },
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
  { accessor: 'creditor', table: 'creditors' },
  { accessor: 'device', table: 'devices' },
  // External API keys for /v1/external/*. Survive backup/restore so
  // integrations (e.g. AI Marketing Agent) keep working after a
  // restore. Bcrypt'd secret column is included — the plaintext was
  // already lost at creation time, so restoring the hash is safe.
  { accessor: 'externalApiKey', table: 'external_api_keys' },

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
  // Addon groups + their option junctions (Phase 3). Restored after
  // menu_items because group.menuItemId + option.addonItemId both FK
  // into it. Cleanup-ordering mirror lives in cleanup.service.
  { accessor: 'menuItemAddonGroup', table: 'menu_item_addon_groups' },
  { accessor: 'menuItemAddonOption', table: 'menu_item_addon_options' },

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
  { accessor: 'supplierAdjustment', table: 'supplier_adjustments' },
  { accessor: 'creditorBill', table: 'creditor_bills' },
  { accessor: 'creditorPayment', table: 'creditor_payments' },
  { accessor: 'creditorAdjustment', table: 'creditor_adjustments' },
  { accessor: 'wasteLog', table: 'waste_logs' },

  // Tier 7 — discounts, coupons, campaigns & reservation
  { accessor: 'discount', table: 'discounts' },
  // Coupon campaigns hold the parameters of a generated batch + the
  // SMS template used at send time. Coupons reference them via the
  // soft `campaignTag` string (no FK), so order between the two
  // tables doesn't matter for FK resolution — but campaigns first
  // for clarity.
  { accessor: 'couponCampaign', table: 'coupon_campaigns' },
  { accessor: 'coupon', table: 'coupons' },
  { accessor: 'menuItemDiscount', table: 'menu_item_discounts' },
  // Auto-Facebook-post queue. References menuItemDiscount via FK with
  // SetNull on delete, so it MUST come after menuItemDiscount in the
  // restore order. Image bytes themselves live in uploads/social/ —
  // not in this manifest; admin re-rendering an old discount will
  // regenerate the image on demand.
  { accessor: 'scheduledFbPost', table: 'scheduled_fb_posts' },
  { accessor: 'reservation', table: 'reservations' },

  // Tier 8 — orders (depend on menu, tables, customers, staff, coupons/discounts)
  { accessor: 'order', table: 'orders' },
  { accessor: 'orderItem', table: 'order_items' },
  { accessor: 'orderPayment', table: 'order_payments' },
  { accessor: 'review', table: 'reviews' },
  // Loyalty points ledger — references customer + branch + (optionally)
  // order. Restored after orders so the orderId FK on EARNED /
  // REDEEMED rows resolves cleanly.
  { accessor: 'loyaltyTransaction', table: 'loyalty_transactions' },

  // Tier 9 — HR (depend on staff + salaryStructure / leaveRule from Tier 2)
  { accessor: 'workPeriod', table: 'work_periods' },
  { accessor: 'attendance', table: 'attendance' },
  // Salary components reference salary_structures (already in Tier 2);
  // no FK to staff but logically grouped here with the rest of HR.
  { accessor: 'salaryComponent', table: 'salary_components' },
  { accessor: 'payroll', table: 'payrolls' },
  { accessor: 'payrollPayment', table: 'payroll_payments' },
  // Leave rule entries + per-staff balances. Rule itself sits in Tier 2.
  { accessor: 'leaveRuleEntry', table: 'leave_rule_entries' },
  { accessor: 'leaveBalance', table: 'leave_balances' },
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

  // Tier 13 — admin-config audit trail. Back up AFTER staff (FK to
  // actorId, SetNull on delete) and AFTER all other tables so a
  // restored snapshot replays the full chain of admin events in
  // chronological order. Auto-purged at 90 days by the scheduler so
  // older rows simply won't be present in the manifest.
  { accessor: 'activityLog', table: 'activity_logs' },
];

export const BACKUP_FILE_VERSION = 1;
