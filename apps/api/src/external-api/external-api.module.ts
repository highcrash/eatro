import { Module } from '@nestjs/common';

import { ExpenseModule } from '../expense/expense.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MarketingModule } from '../marketing/marketing.module';
import { MenuModule } from '../menu/menu.module';
import { ReportsModule } from '../reports/reports.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ExternalController } from './external.controller';
import { ExternalService } from './external.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ScopesGuard } from './guards/scopes.guard';

@Module({
  imports: [ReportsModule, MenuModule, MarketingModule, LoyaltyModule, ExpenseModule],
  controllers: [ApiKeysController, ExternalController],
  providers: [ApiKeysService, ExternalService, ApiKeyGuard, ScopesGuard],
  exports: [ApiKeysService],
})
export class ExternalApiModule {}
