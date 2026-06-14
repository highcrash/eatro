import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AccountModule } from '../account/account.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  // PayrollModule is imported so ExpenseService.remove can call
  // payrollService.reverseSalaryPaymentForDeletedExpense() when admin
  // deletes a SALARY expense auto-created from a payroll payment.
  // Without it the payroll kept showing PAID after the matching
  // expense was removed.
  imports: [AccountModule, ActivityLogModule, PayrollModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
