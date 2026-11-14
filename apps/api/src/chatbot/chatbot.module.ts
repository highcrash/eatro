import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CustomerModule } from '../customer/customer.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicModule } from '../public/public.module';
import { ReservationModule } from '../reservation/reservation.module';
import { SmsModule } from '../sms/sms.module';
import { WsGatewayModule } from '../ws-gateway/ws-gateway.module';
import { AiAdminService } from './ai/ai-admin.service';
import { AiRouterService } from './ai/ai-router.service';
import { AnthropicProvider } from './ai/anthropic.provider';
import { OpenAiCompatibleProvider } from './ai/openai-compatible.provider';
import { ChatbotAdminService } from './chatbot-admin.service';
import { AiAdminController, ChatbotAdminController, ChatbotPublicController, ConnectCallbackController, ConnectController, MetaWebhookController, SocialAdminController } from './chatbot.controller';
import { CommentService } from './comment.service';
import { ComplaintService } from './complaint.service';
import { ConnectService } from './meta/connect.service';
import { MetaAccountService } from './meta/meta-account.service';
import { MetaWebhookService } from './meta/meta-webhook.service';
import { MetaClient } from './meta/meta.client';
import { PostContextService } from './post-context.service';
import { ChatbotScheduler } from './chatbot.scheduler';
import { ChatbotService } from './chatbot.service';
import { MenuContextService } from './menu-context';

@Module({
  imports: [PrismaModule, PublicModule, ReservationModule, CustomerModule, WsGatewayModule, ActivityLogModule, SmsModule],
  controllers: [ChatbotPublicController, ChatbotAdminController, AiAdminController, MetaWebhookController, ConnectCallbackController, ConnectController, SocialAdminController],
  providers: [
    OpenAiCompatibleProvider,
    AnthropicProvider,
    AiRouterService,
    AiAdminService,
    MenuContextService,
    ChatbotService,
    ChatbotAdminService,
    ChatbotScheduler,
    MetaClient,
    MetaAccountService,
    PostContextService,
    ComplaintService,
    CommentService,
    MetaWebhookService,
    ConnectService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
