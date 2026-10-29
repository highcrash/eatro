import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ExpenseModule } from '../expense/expense.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MarketingModule } from '../marketing/marketing.module';
import { MenuModule } from '../menu/menu.module';
import { RecipeModule } from '../recipe/recipe.module';
import { ReportsModule } from '../reports/reports.module';
import { SmsModule } from '../sms/sms.module';
import { ActorSynthesisService } from './actor-synthesis';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ExternalMenuController } from './external-menu.controller';
import { ExternalController } from './external.controller';
import { ExternalService } from './external.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ScopesGuard } from './guards/scopes.guard';

@Module({
  imports: [ReportsModule, MenuModule, RecipeModule, ActivityLogModule, MarketingModule, LoyaltyModule, ExpenseModule, SmsModule],
  controllers: [ApiKeysController, ExternalController, ExternalMenuController],
  providers: [ApiKeysService, ExternalService, ApiKeyGuard, ScopesGuard, ActorSynthesisService],
  exports: [ApiKeysService],
})
export class ExternalApiModule {}
