import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
