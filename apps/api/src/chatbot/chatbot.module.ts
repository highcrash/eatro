import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CustomerModule } from '../customer/customer.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicModule } from '../public/public.module';
import { ReservationModule } from '../reservation/reservation.module';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService } from './ai/ai-router.service';
import { AnthropicProvider } from './ai/anthropic.provider';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotAdminService } from './chatbot-admin.service';
import { AiAdminController, ChatbotAdminController, ChatbotPublicController } from './chatbot.controller';
import { ChatbotScheduler } from './chatbot.scheduler';
import { ChatbotService } from './chatbot.service';
import { MenuContextService } from './menu-context';

@Module({
  imports: [PrismaModule, PublicModule, ReservationModule, CustomerModule, WsGatewayModule, ActivityLogModule],
  controllers: [ChatbotPublicController, ChatbotAdminController, AiAdminController],
  providers: [
    OpenAiCompatibleProvider,
    AnthropicProvider,
    AiRouterService,
    AiAdminService,
    MenuContextService,
    ChatbotService,
    ChatbotAdminService,
    ChatbotScheduler,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
