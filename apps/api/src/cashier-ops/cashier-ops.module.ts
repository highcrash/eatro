import { Module } from '@nestjs/common';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SupplierModule } from '../supplier/supplier.module';
import { ExpenseModule } from '../expense/expense.module';
import { PayrollModule } from '../payroll/payroll.module';
import { PreReadyModule } from '../pre-ready/pre-ready.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SmsModule } from '../sms/sms.module';
import { MenuModule } from '../menu/menu.module';
import { CashierOpsController } from './cashier-ops.controller';

@Module({
  imports: [PurchasingModule, SupplierModule, ExpenseModule, PayrollModule, PreReadyModule, PermissionsModule, SmsModule, MenuModule],
  controllers: [CashierOpsController],
})
export class CashierOpsModule {}
