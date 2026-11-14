import type { PrismaService } from '../prisma/prisma.service';

/**
 * Throwaway branch for chat-assistant tests, so test files that run at the
 * same time never change each other's settings or Meta credentials.
 * Only for local test databases.
 */
export async function createTestBranch(prisma: PrismaService, label: string): Promise<string> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('Chat tests only run against a local database');
  const b = await prisma.branch.create({ data: { name: `Test ${label}`, address: 'Test address', phone: '01700000000', timezone: 'Asia/Dhaka' } });
  return b.id;
}

export async function deleteTestBranch(prisma: PrismaService, branchId: string): Promise<void> {
  const convs = await prisma.chatConversation.findMany({ where: { branchId }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.chatLead.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.chatConversation.deleteMany({ where: { branchId } });
  await prisma.chatComplaint.deleteMany({ where: { branchId } });
  await prisma.chatComment.deleteMany({ where: { branchId } });
  await prisma.chatPostContext.deleteMany({ where: { branchId } });
  await prisma.chatUnanswered.deleteMany({ where: { branchId } });
  await prisma.chatQuickReply.deleteMany({ where: { branchId } });
  await prisma.chatRuleVersion.deleteMany({ where: { branchId } });
  await prisma.chatbotSetting.deleteMany({ where: { branchId } });
  await prisma.aiUsage.deleteMany({ where: { branchId } });
  await prisma.aiRoute.deleteMany({ where: { branchId } });
  await prisma.aiConfigHistory.deleteMany({ where: { branchId } });
  await prisma.aiConnection.deleteMany({ where: { branchId } });
  await prisma.metaAppSetting.deleteMany({ where: { branchId } });
  await prisma.scheduledFbPost.deleteMany({ where: { branchId } });
  const items = await prisma.menuItem.findMany({ where: { branchId }, select: { id: true } });
  await prisma.menuItemDiscount.deleteMany({ where: { menuItemId: { in: items.map((i) => i.id) } } });
  await prisma.menuItem.deleteMany({ where: { branchId } });
  await prisma.menuCategory.deleteMany({ where: { branchId } });
  await prisma.activityLog.deleteMany({ where: { branchId } });
  await prisma.staffPushSubscription.deleteMany({ where: { branchId } });
  await prisma.staff.deleteMany({ where: { branchId } });
  await prisma.branchSetting.deleteMany({ where: { branchId } });
  await prisma.branch.delete({ where: { id: branchId } });
}
