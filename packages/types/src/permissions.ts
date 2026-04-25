// ─── Cashier Permissions (Phase 6) ────────────────────────────────────────────
//
// Stored as JSON on BranchSetting.cashierPermissions and applied branch-wide
// to every staff member with role === 'CASHIER'.
//
// Approval modes:
//   NONE  — action is hidden in POS entirely (admin can still do it from admin panel)
//   AUTO  — cashier can perform the action with no challenge
//   OTP   — cashier must enter a manager-issued OTP before submitting

export type ApprovalMode = 'NONE' | 'AUTO' | 'OTP';

export type CashierAction =
  | 'createPurchaseOrder'
  | 'receivePurchaseOrder'
  | 'returnPurchaseOrder'
  | 'paySupplier'
  | 'createExpense'
  | 'payPayroll'
  | 'createPreReadyKT'
  | 'createCustomMenu';

export interface ActionPermission {
  enabled: boolean;
  approval: ApprovalMode;
}

export interface ExpensePermission extends ActionPermission {
  /** Expense category codes the cashier may use. Empty array = none. */
  allowedCategories: string[];
  /** Per-category override of the action-level approval mode. */
  categoryApproval: Record<string, ApprovalMode>;
}

export interface CashierPermissions {
  createPurchaseOrder: ActionPermission;
  receivePurchaseOrder: ActionPermission;
  returnPurchaseOrder: ActionPermission;
  paySupplier: ActionPermission;
  createExpense: ExpensePermission;
  payPayroll: ActionPermission;
  createPreReadyKT: ActionPermission;
  createCustomMenu: ActionPermission;
}

/** Defaults applied when BranchSetting.cashierPermissions is null or invalid. */
export const DEFAULT_CASHIER_PERMISSIONS: CashierPermissions = {
  createPurchaseOrder:  { enabled: false, approval: 'OTP' },
  receivePurchaseOrder: { enabled: false, approval: 'OTP' },
  returnPurchaseOrder:  { enabled: false, approval: 'OTP' },
  paySupplier:          { enabled: false, approval: 'OTP' },
  createExpense:        { enabled: false, approval: 'OTP', allowedCategories: [], categoryApproval: {} },
  payPayroll:           { enabled: false, approval: 'OTP' },
  createPreReadyKT:     { enabled: false, approval: 'AUTO' },
  createCustomMenu:     { enabled: false, approval: 'AUTO' },
};

export function parseCashierPermissions(raw: string | null | undefined): CashierPermissions {
  if (!raw) return DEFAULT_CASHIER_PERMISSIONS;
  try {
    const parsed = JSON.parse(raw) as Partial<CashierPermissions>;
    const merged = { ...DEFAULT_CASHIER_PERMISSIONS, ...parsed } as CashierPermissions;

    // Backward-compat self-heal: any action saved as enabled+NONE is contradictory
    // (enabled means "show in POS", NONE means "hide in POS"). The original default
    // for createPreReadyKT shipped that way. Coerce to enabled+AUTO so the action
    // is actually usable without forcing the admin to re-save.
    const fix = (a: ActionPermission): ActionPermission =>
      a.enabled && a.approval === 'NONE' ? { ...a, approval: 'AUTO' } : a;

    return {
      createPurchaseOrder:  fix(merged.createPurchaseOrder),
      receivePurchaseOrder: fix(merged.receivePurchaseOrder),
      returnPurchaseOrder:  fix(merged.returnPurchaseOrder),
      paySupplier:          fix(merged.paySupplier),
      createExpense:        { ...merged.createExpense, ...(fix(merged.createExpense) as ActionPermission) },
      payPayroll:           fix(merged.payPayroll),
      createPreReadyKT:     fix(merged.createPreReadyKT),
      createCustomMenu:     fix(merged.createCustomMenu),
    };
  } catch {
    return DEFAULT_CASHIER_PERMISSIONS;
  }
}
