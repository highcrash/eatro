import type { AuditFields } from './common';
import type { UserRole } from './auth';
import type { CashierPermissions } from './permissions';

// ─── Staff ────────────────────────────────────────────────────────────────────

export interface StaffMember extends AuditFields {
  id: string;
  branchId: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  customRoleId?: string | null;
  customRole?: CustomRole | null;
  isActive: boolean;
  canAccessPos: boolean;
  hireDate: Date;
  monthlySalary?: number | null;
  /** Tipsoi person_identifier (e.g. "Ahmed-1234"). Optional — staff
   *  who never clock in (Owner, Advisor) leave this blank. */
  tipsoiPersonId?: string | null;
  /** Per-staff shift overrides — HH:mm 24h, branch local time. Empty =
   *  fall back to BranchSetting.attendanceShiftStart / shiftEnd. */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  /** Per-staff late + half-day overrides (minutes after shiftStart).
   *  Null = fall back to BranchSetting defaults. */
  lateGraceMinutes?: number | null;
  halfDayAfterMinutes?: number | null;
}

export interface CreateStaffDto {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: UserRole;
  customRoleId?: string | null;
  hireDate?: string;
  canAccessPos?: boolean;
  tipsoiPersonId?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  lateGraceMinutes?: number | null;
  halfDayAfterMinutes?: number | null;
}

export interface UpdateStaffDto extends Partial<Omit<CreateStaffDto, 'password'>> {
  isActive?: boolean;
  password?: string;
  canAccessPos?: boolean;
  customRoleId?: string | null;
}

// ─── Custom Roles ────────────────────────────────────────────────────────────

/**
 * Admin-nav override map. Keys are the nav item `to` path (e.g. "/staff"),
 * values are booleans. Only `false` is meaningful — it HIDES the item for
 * staff assigned this custom role. Missing keys or `true` defer to the
 * base role's existing allowedRoles check. A custom role cannot REVEAL
 * items the base role doesn't already have access to.
 */
export type CustomRoleNavOverrides = Record<string, boolean>;

export interface CustomRole extends AuditFields {
  id: string;
  branchId: string;
  name: string;
  description: string | null;
  baseRole: UserRole;
  adminNavOverrides: CustomRoleNavOverrides | null;
  posPermissions: Partial<CashierPermissions> | null;
  isActive: boolean;
}

export interface CreateCustomRoleDto {
  name: string;
  description?: string | null;
  baseRole: UserRole;
  adminNavOverrides?: CustomRoleNavOverrides | null;
  posPermissions?: Partial<CashierPermissions> | null;
}

export interface UpdateCustomRoleDto extends Partial<CreateCustomRoleDto> {
  isActive?: boolean;
}
