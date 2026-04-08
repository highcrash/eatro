export type AccountType = 'CASH' | 'BANK' | 'MFS' | 'POS_TERMINAL';
export type TransactionType = 'SALE' | 'EXPENSE' | 'PURCHASE_PAYMENT' | 'TRANSFER' | 'ADJUSTMENT';

export interface Account {
  id: string;
  branchId: string;
  type: AccountType;
  name: string;
  balance: number;
  isActive: boolean;
  showInPOS: boolean;
  linkedPaymentMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountTransaction {
  id: string;
  branchId: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  description: string;
  referenceId: string | null;
  createdAt: Date;
  account?: Account;
}

export interface CreateAccountDto {
  type: AccountType;
  name: string;
  balance?: number;
  showInPOS?: boolean;
  linkedPaymentMethod?: string | null;
}

export interface AdjustBalanceDto {
  amount: number;
  description: string;
}

export interface PnlReport {
  period: { from: string; to: string };
  revenue: { total: number; byMethod: Record<string, number> };
  expenses: { total: number; byCategory: Record<string, number> };
  purchasingCost: number;
  grossProfit: number;
  netProfit: number;
  accounts: { name: string; type: string; balance: number }[];
}
