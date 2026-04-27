import type { ExpenseCategory } from './expense';

/// Type of non-supplier liability tracked under Liabilities (Creditors).
export type CreditorCategory = 'UTILITY' | 'LANDLORD' | 'BANK' | 'INDIVIDUAL' | 'OTHER';

export interface Creditor {
  id: string;
  branchId: string;
  name: string;
  category: CreditorCategory;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  defaultExpenseCategory: ExpenseCategory;
  openingBalance: number;
  totalDue: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreditorBill {
  id: string;
  branchId: string;
  creditorId: string;
  description: string;
  amount: number;
  billDate: string | Date;
  dueDate: string | Date | null;
  notes: string | null;
  recordedById: string;
  createdAt: Date;
  recordedBy?: { id: string; name: string };
}

export interface CreditorPayment {
  id: string;
  branchId: string;
  creditorId: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  paidById: string;
  createdAt: Date;
  paidBy?: { id: string; name: string };
}

/** Manual ledger correction (Owner/Manager only). Pure ledger-only:
 *  adjusts Creditor.totalDue and shows up in the creditor ledger view
 *  as its own line. Never touches a cash/bank account or creates an
 *  Expense mirror. Negative amount reduces debt, positive amount
 *  increases it. */
export interface CreditorAdjustment {
  id: string;
  branchId: string;
  creditorId: string;
  amount: number;
  reason: string;
  recordedById: string;
  createdAt: Date;
  recordedBy?: { id: string; name: string };
}

// DTOs
export interface CreateCreditorDto {
  name: string;
  category?: CreditorCategory;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  defaultExpenseCategory?: ExpenseCategory;
  /** Old outstanding balance carried forward (in paisa). Sets totalDue. */
  openingBalance?: number;
}

export interface UpdateCreditorDto {
  name?: string;
  category?: CreditorCategory;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  defaultExpenseCategory?: ExpenseCategory;
  isActive?: boolean;
}

export interface RecordCreditorBillDto {
  description: string;
  amount: number;
  billDate?: string;
  dueDate?: string;
  notes?: string;
}

export interface MakeCreditorPaymentDto {
  amount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
}

export interface RecordCreditorAdjustmentDto {
  /** Signed: negative reduces totalDue, positive increases. */
  amount: number;
  reason: string;
}

export interface CreditorLedgerResponse {
  creditor: Creditor;
  openingBalance: number;
  totalBilled: number;
  totalPaid: number;
  totalAdjustments: number;
  balance: number;
  bills: CreditorBill[];
  payments: CreditorPayment[];
  adjustments: CreditorAdjustment[];
}
