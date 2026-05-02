import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AccountModule } from '../account/account.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [AccountModule, ActivityLogModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
