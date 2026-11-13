import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

/** Chats are kept for the branch's retention period (90 days by default), then deleted. */
@Injectable()
export class ChatbotScheduler {
  private readonly logger = new Logger(ChatbotScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 40 3 * * *')
  async purgeOldChats() {
    const settings = await this.prisma.chatbotSetting.findMany({ select: { branchId: true, retentionDays: true } });
    for (const s of settings) {
      const cutoff = new Date(Date.now() - s.retentionDays * 86_400_000);
      const [convs, unanswered] = await Promise.all([
        this.prisma.chatConversation.deleteMany({ where: { branchId: s.branchId, lastMessageAt: { lt: cutoff } } }),
        this.prisma.chatUnanswered.deleteMany({ where: { branchId: s.branchId, createdAt: { lt: cutoff } } }),
      ]);
      if (convs.count || unanswered.count) this.logger.log(`Deleted ${convs.count} chats and ${unanswered.count} unanswered questions older than ${s.retentionDays} days`);
    }
    // Test-bot chats are throwaway.
    await this.prisma.chatConversation.deleteMany({ where: { isTest: true, lastMessageAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } });
    // Usage rows back the cost reports; a year and a bit is plenty.
    await this.prisma.aiUsage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 400 * 86_400_000) } } });
  }
}
