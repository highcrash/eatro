import type { PayrollStatus } from '@restora/types';

export const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'text-[#FFA726] bg-[#3a2e00]',
  APPROVED: 'text-[#29B6F6] bg-[#00243a]',
  PAID: 'text-[#4CAF50] bg-[#1a3a1a]',
};
