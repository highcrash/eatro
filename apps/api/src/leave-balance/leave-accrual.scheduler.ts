import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeaveBalanceService } from './leave-balance.service';

/**
 * Two scheduled handlers driving the leave accrual:
 *
 *   - Monthly: 01:00 on the 1st of every month, credits each staff's
 *     LeaveBalance by their rule entry's `accrualPerMonth`.
 *   - Annual: 02:00 on Jan 1, credits the `annualGrant` upfront.
 *
 * Both delegate to LeaveBalanceService methods that are idempotent
 * via `lastAccrualAt` / `lastAnnualGrantAt` — so a manual trigger
 * earlier in the day, an admin clicking "Accrue Now" mid-month, or
 * a duplicate cron firing are all safe.
 */
@Injectable()
export class LeaveAccrualScheduler {
  private readonly logger = new Logger(LeaveAccrualScheduler.name);

  constructor(private readonly leaveBalance: LeaveBalanceService) {}

  @Cron('0 1 1 * *')
  async runMonthly() {
    try {
      const credited = await this.leaveBalance.runMonthlyAccrual();
      this.logger.log(`Monthly leave accrual credited ${credited} balance row(s)`);
    } catch (err) {
      this.logger.error(`Monthly leave accrual failed: ${(err as Error).message}`);
    }
  }

  @Cron('0 2 1 1 *')
  async runAnnual() {
    try {
      const credited = await this.leaveBalance.runAnnualGrant();
      this.logger.log(`Annual leave grant credited ${credited} balance row(s)`);
    } catch (err) {
      this.logger.error(`Annual leave grant failed: ${(err as Error).message}`);
    }
  }
}

// Silence unused-var when the file is imported only for its side effects.
void CronExpression;
