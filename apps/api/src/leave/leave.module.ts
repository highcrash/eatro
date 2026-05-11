import { Module } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { LeaveBalanceModule } from '../leave-balance/leave-balance.module';

@Module({
  imports: [LeaveBalanceModule],
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
