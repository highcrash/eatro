export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'PAID_LEAVE' | 'SICK_LEAVE' | 'FESTIVAL_LEAVE';
export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';
export type AttendanceSource = 'MANUAL' | 'TIPSOI';

export interface Attendance {
  id: string;
  branchId: string;
  staffId: string;
  date: string; // ISO date
  clockIn: Date | null;
  clockOut: Date | null;
  status: AttendanceStatus;
  notes: string | null;
  /** Where this row's status came from. Manual marks always win
   *  against subsequent Tipsoi syncs. */
  source: AttendanceSource;
  /** True when an admin has hand-set this row. The Tipsoi sync skips
   *  rows with this flag. Cleared by the Restore-from-Tipsoi action. */
  manualOverride: boolean;
  /** First clock event from the device on this shift date (separate
   *  from the admin-editable clockIn). */
  syncedClockIn: Date | null;
  syncedClockOut: Date | null;
  /** Tipsoi log uid that produced syncedClockIn. */
  syncedFromUid: string | null;
  createdAt: Date;
  updatedAt: Date;
  staff?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface TipsoiSyncResult {
  branchId: string;
  range: { from: string; to: string };
  scanned: number;
  created: number;
  updated: number;
  skippedByOverride: number;
  errors: string[];
}

export interface Payroll {
  id: string;
  branchId: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  baseSalary: number;
  deductions: number;
  bonuses: number;
  netPayable: number;
  daysPresent: number;
  daysAbsent: number;
  status: PayrollStatus;
  notes: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  paidAmount: number;
  staff?: { id: string; name: string; role: string };
  approvedBy?: { id: string; name: string } | null;
  payments?: PayrollPayment[];
}

export interface PayrollPayment {
  id: string;
  payrollId: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  paidById: string;
  createdAt: Date;
  paidBy?: { id: string; name: string };
}

export interface MarkAttendanceDto {
  staffId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  clockIn?: string; // ISO datetime
  clockOut?: string;
  notes?: string;
}

export interface GeneratePayrollDto {
  staffId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  baseSalary: number;
  deductions?: number;
  bonuses?: number;
  notes?: string;
}

export interface ApprovePayrollDto {
  notes?: string;
}

export type LeaveType = 'SICK' | 'CASUAL' | 'ANNUAL' | 'UNPAID' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LeaveApplication {
  id: string;
  branchId: string;
  staffId: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  reason: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  staff?: { id: string; name: string; role: string };
  reviewedBy?: { id: string; name: string } | null;
}

export interface CreateLeaveDto {
  staffId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}
