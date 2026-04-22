import type { AuditFields } from './common';
import type { UserRole } from './auth';

// ─── Staff ────────────────────────────────────────────────────────────────────

export interface StaffMember extends AuditFields {
  id: string;
  branchId: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  canAccessPos: boolean;
  hireDate: Date;
  monthlySalary?: number | null;
}

export interface CreateStaffDto {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: UserRole;
  hireDate?: string;
  canAccessPos?: boolean;
}

export interface UpdateStaffDto extends Partial<Omit<CreateStaffDto, 'password'>> {
  isActive?: boolean;
  password?: string;
  canAccessPos?: boolean;
}
