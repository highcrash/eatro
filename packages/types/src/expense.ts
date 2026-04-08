export type ExpenseCategory =
  | 'RENT' | 'UTILITIES' | 'SALARY' | 'SUPPLIES'
  | 'MAINTENANCE' | 'TRANSPORT' | 'MARKETING'
  | 'FOOD_COST' | 'STAFF_FOOD' | 'MISCELLANEOUS';

export interface Expense {
  id: string;
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
  date: string;
  recordedById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  recordedBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
}

export interface CreateExpenseDto {
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod?: string;
  reference?: string;
  date: string; // YYYY-MM-DD
  notes?: string;
}

export interface UpdateExpenseDto {
  category?: ExpenseCategory;
  description?: string;
  amount?: number;
  paymentMethod?: string;
  reference?: string;
  date?: string;
  notes?: string;
}
