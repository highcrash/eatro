import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConnection, AiJob, AiProviderType, Prisma } from '@prisma/client';
import type { JwtPayload } from '@restora/types';

import { ActivityLogService } from '../../activity-log/activity-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotService } from '../chatbot.service';
import { MenuContextService } from '../menu-context';
import { buildSystemPrompt, buildVisionPrompt, contextLine } from '../prompt';
import { ownerAmounts, parseAiReply } from '../reply';
import { decryptSecret, encryptSecret, keyHint, secretsKey } from '../secrets';
import { parseVisionMatches } from '../chatbot.service';
import { AiRouterService } from './ai-router.service';
import { AiError, AiImageMediaType } from './ai.types';
import { CHAT_SELF_TEST, scoreChatCase, SELF_TEST_PASS_SCORE, SelfTestCaseResult } from './model-selftest';
import { OPENROUTER_BASE_URL, OpenAiCompatibleProvider } from './openai-compatible.provider';

export interface ConnectionInput {
  name?: string;
  provider?: AiProviderType;
  baseUrl?: string | null;
  apiKey?: string;
  model?: string;
  supportsVision?: boolean;
  isActive?: boolean;
  monthlyBudget?: number | null;
  dailyRequestLimit?: number | null;
  inputPricePerM?: number;
  outputPricePerM?: number;
}

const JOBS: AiJob[] = ['CHAT', 'VISION', 'COMMENT'];
const JOB_LABEL: Record<AiJob, string> = { CHAT: 'Chat replies', VISION: 'Photo recognition', COMMENT: 'Unclear comments' };

const nonNegative = (v: unknown, field: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be zero or more`);
  return n;
};

@Injectable()
export class AiAdminService {
  private readonly logger = new Logger(AiAdminService.name);
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: ConfigService,
    private readonly router: AiRouterService,
    private readonly openAi: OpenAiCompatibleProvider,
    private readonly chatbot: ChatbotService,
    private readonly menus: MenuContextService,
    private readonly activity: ActivityLogService,
  ) {}

  private key() {
    return secretsKey({ SECRETS_KEY: this.env.get<string>('SECRETS_KEY'), JWT_SECRET: this.env.get<string>('JWT_SECRET') });
  }

  // ── Connections ────────────────────────────────────────────────────────────

  /** What admin sees. The key itself never leaves the server. */
  private async view(c: AiConnection) {
    const plain = decryptSecret(c.apiKeyEnc, this.key());
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [month, today] = await Promise.all([
      this.prisma.aiUsage.aggregate({ where: { connectionId: c.id, createdAt: { gte: monthStart } }, _sum: { costUsd: true }, _count: true }),
      this.prisma.aiUsage.count({ where: { connectionId: c.id, createdAt: { gte: dayStart } } }),
    ]);
    const setting = await this.prisma.chatbotSetting.findUnique({ where: { branchId: c.branchId }, select: { usdRate: true } });
    const monthCostTaka = Number(month._sum.costUsd ?? 0) * Number(setting?.usdRate ?? 122);
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      baseUrl: c.baseUrl,
      model: c.model,
      supportsVision: c.supportsVision,
      isActive: c.isActive,
      monthlyBudget: c.monthlyBudget == null ? null : Number(c.monthlyBudget),
      dailyRequestLimit: c.dailyRequestLimit,
      inputPricePerM: Number(c.inputPricePerM),
      outputPricePerM: Number(c.outputPricePerM),
      keySet: !!plain,
      keyHint: plain ? keyHint(plain) : null,
      keyUnreadable: !plain,
      selfTestScore: c.selfTestScore,
      selfTestAt: c.selfTestAt,
      selfTestDetail: c.selfTestDetail,
      selfTestRunning: this.running.has(c.id),
      requestsToday: today,
      requestsThisMonth: month._count,
      costThisMonthTaka: Math.round(monthCostTaka * 100) / 100,
      budgetUsedPercent: c.monthlyBudget != null && Number(c.monthlyBudget) > 0 ? Math.round((monthCostTaka / Number(c.monthlyBudget)) * 100) : null,
      createdAt: c.createdAt,
    };
  }

  async list(branchId: string) {
    const rows = await this.prisma.aiConnection.findMany({ where: { branchId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  private async find(branchId: string, id: string) {
    const row = await this.prisma.aiConnection.findFirst({ where: { id, branchId, deletedAt: null } });
    if (!row) throw new NotFoundException('AI connection not found');
    return row;
  }

  private clean(input: ConnectionInput, creating: boolean) {
    const data: Prisma.AiConnectionUncheckedUpdateInput = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequestException('Give the connection a name');
      data.name = input.name.trim().slice(0, 80);
    }
    if (input.provider !== undefined) {
      if (input.provider !== 'OPENAI_COMPATIBLE' && input.provider !== 'ANTHROPIC') throw new BadRequestException('Unknown provider type');
      data.provider = input.provider;
    }
    if (input.baseUrl !== undefined) {
      const url = input.baseUrl?.trim() || null;
      if (url && !/^https:\/\/[^\s/]+/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
        throw new BadRequestException('The address must start with https://');
      }
      data.baseUrl = url ? url.replace(/\/+$/, '') : null;
    }
    if (input.model !== undefined) {
      if (!input.model.trim()) throw new BadRequestException('Enter the model id');
      data.model = input.model.trim();
    }
    if (input.apiKey !== undefined) {
      if (!input.apiKey.trim()) throw new BadRequestException('Paste the API key');
      data.apiKeyEnc = encryptSecret(input.apiKey.trim(), this.key());
    } else if (creating) {
      throw new BadRequestException('Paste the API key');
    }
    if (input.supportsVision !== undefined) data.supportsVision = !!input.supportsVision;
    if (input.isActive !== undefined) data.isActive = !!input.isActive;
    if (input.monthlyBudget !== undefined) data.monthlyBudget = input.monthlyBudget == null ? null : nonNegative(input.monthlyBudget, 'Monthly budget');
    if (input.dailyRequestLimit !== undefined) {
      data.dailyRequestLimit = input.dailyRequestLimit == null ? null : Math.floor(nonNegative(input.dailyRequestLimit, 'Daily request limit'));
    }
    if (input.inputPricePerM !== undefined) data.inputPricePerM = nonNegative(input.inputPricePerM, 'Input price');
    if (input.outputPricePerM !== undefined) data.outputPricePerM = nonNegative(input.outputPricePerM, 'Output price');
    return data;
  }

  async create(branchId: string, input: ConnectionInput, user: JwtPayload) {
    if (!input.name || !input.model || !input.provider) throw new BadRequestException('Name, provider and model are required');
    const data = this.clean(input, true) as Prisma.AiConnectionUncheckedCreateInput;
    if (data.provider === 'OPENAI_COMPATIBLE' && !data.baseUrl) data.baseUrl = OPENROUTER_BASE_URL;
    if (data.provider === 'ANTHROPIC') data.baseUrl = null;
    const row = await this.prisma.aiConnection.create({ data: { ...data, branchId } });
    this.router.invalidate(branchId);
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'CREATE', entityType: 'AiConnection', entityId: row.id, entityName: row.name, summary: `Added AI connection ${row.name} (${row.model})` });
    return this.view(row);
  }

  async update(branchId: string, id: string, input: ConnectionInput, user: JwtPayload) {
    const before = await this.find(branchId, id);
    const data = this.clean(input, false);
    // A different model or key has not sat the exam yet.
    if ((data.model && data.model !== before.model) || data.apiKeyEnc || (data.baseUrl !== undefined && data.baseUrl !== before.baseUrl)) {
      data.selfTestScore = null;
      data.selfTestAt = null;
      data.selfTestDetail = undefined;
    }
    const row = await this.prisma.aiConnection.update({ where: { id }, data });
    this.router.invalidate(branchId);
    void this.activity.log({
      branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'AiConnection', entityId: id, entityName: row.name,
      before: { model: before.model, isActive: before.isActive, monthlyBudget: before.monthlyBudget },
      after: { model: row.model, isActive: row.isActive, monthlyBudget: row.monthlyBudget, keyChanged: !!input.apiKey },
    });
    return this.view(row);
  }

  async remove(branchId: string, id: string, user: JwtPayload) {
    const row = await this.find(branchId, id);
    const routes = await this.prisma.aiRoute.findMany({ where: { branchId } });
    const inUse = routes.filter((r) => ((r.connectionIds as string[]) ?? []).includes(id) || r.splitConnectionId === id || r.shadowConnectionId === id);
    if (inUse.length > 0) throw new BadRequestException(`Remove it from ${inUse.map((r) => JOB_LABEL[r.job]).join(' and ')} first`);
    await this.prisma.aiConnection.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    this.router.invalidate(branchId);
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'DELETE', entityType: 'AiConnection', entityId: id, entityName: row.name });
    return { ok: true };
  }

  // ── Routes (which connection does which job) ──────────────────────────────

  async routes(branchId: string) {
    const rows = await this.prisma.aiRoute.findMany({ where: { branchId } });
    const byJob = new Map(rows.map((r) => [r.job, r]));
    const history = await this.prisma.aiConfigHistory.findFirst({ where: { branchId }, orderBy: { createdAt: 'desc' } });
    return {
      routes: JOBS.map((job) => {
        const r = byJob.get(job);
        return {
          job,
          label: JOB_LABEL[job],
          connectionIds: ((r?.connectionIds as string[] | undefined) ?? []),
          splitConnectionId: r?.splitConnectionId ?? null,
          splitPercent: r?.splitPercent ?? 0,
          shadowConnectionId: r?.shadowConnectionId ?? null,
        };
      }),
      canSwitchBack: !!history,
      lastChange: history ? { at: history.createdAt, by: history.createdByName, note: history.note } : null,
    };
  }

  async setRoute(
    branchId: string,
    job: AiJob,
    input: { connectionIds?: string[]; splitConnectionId?: string | null; splitPercent?: number; shadowConnectionId?: string | null },
    user: JwtPayload,
  ) {
    if (!JOBS.includes(job)) throw new BadRequestException('Unknown job');
    const ids = [...new Set((input.connectionIds ?? []).map(String))];
    const extra = [input.splitConnectionId, input.shadowConnectionId].filter((x): x is string => !!x);
    const all = [...new Set([...ids, ...extra])];
    const connections = await this.prisma.aiConnection.findMany({ where: { branchId, id: { in: all }, deletedAt: null } });
    if (connections.length !== all.length) throw new BadRequestException('Unknown AI connection');
    for (const c of connections) {
      if (job === 'VISION' && !c.supportsVision) throw new BadRequestException(`${c.name} is not marked as able to read images`);
      if (job !== 'VISION' && (c.selfTestScore ?? -1) < SELF_TEST_PASS_SCORE) {
        throw new BadRequestException(`SELF_TEST_REQUIRED: run the self-test on ${c.name} first. It needs ${SELF_TEST_PASS_SCORE}% or more.`);
      }
    }
    const splitPercent = Math.max(0, Math.min(100, Math.round(Number(input.splitPercent ?? 0)) || 0));

    const actorName = await this.staffName(user);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.aiRoute.findMany({ where: { branchId } });
      await tx.aiConfigHistory.create({
        data: {
          branchId,
          snapshot: current.map((r) => ({ job: r.job, connectionIds: r.connectionIds, splitConnectionId: r.splitConnectionId, splitPercent: r.splitPercent, shadowConnectionId: r.shadowConnectionId })) as Prisma.InputJsonValue,
          note: `Before changing ${JOB_LABEL[job]}`,
          createdByName: actorName,
        },
      });
      await tx.aiRoute.upsert({
        where: { branchId_job: { branchId, job } },
        create: { branchId, job, connectionIds: ids, splitConnectionId: input.splitConnectionId ?? null, splitPercent, shadowConnectionId: input.shadowConnectionId ?? null },
        update: { connectionIds: ids, splitConnectionId: input.splitConnectionId ?? null, splitPercent, shadowConnectionId: input.shadowConnectionId ?? null },
      });
    });
    this.router.invalidate(branchId);
    const names = ids.map((id) => connections.find((c) => c.id === id)?.name).join(' → ');
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'AiRoute', entityId: job, entityName: JOB_LABEL[job], summary: `${JOB_LABEL[job]} now uses ${names || 'no AI'}` });
    return this.routes(branchId);
  }

  /** "Switch back": restore the routes as they were before the last change. */
  async switchBack(branchId: string, user: JwtPayload) {
    const last = await this.prisma.aiConfigHistory.findFirst({ where: { branchId }, orderBy: { createdAt: 'desc' } });
    if (!last) throw new BadRequestException('There is no earlier setup to switch back to');
    const snapshot = (last.snapshot as { job: AiJob; connectionIds: string[]; splitConnectionId: string | null; splitPercent: number; shadowConnectionId: string | null }[]) ?? [];
    await this.prisma.$transaction(async (tx) => {
      await tx.aiRoute.deleteMany({ where: { branchId } });
      for (const r of snapshot) {
        await tx.aiRoute.create({ data: { branchId, job: r.job, connectionIds: r.connectionIds ?? [], splitConnectionId: r.splitConnectionId, splitPercent: r.splitPercent ?? 0, shadowConnectionId: r.shadowConnectionId } });
      }
      await tx.aiConfigHistory.delete({ where: { id: last.id } });
    });
    this.router.invalidate(branchId);
    void this.activity.log({ branchId, actor: user, category: 'SETTINGS', action: 'UPDATE', entityType: 'AiRoute', entityId: 'switch-back', entityName: 'AI models', summary: 'Switched AI models back to the previous setup' });
    return this.routes(branchId);
  }

  private async staffName(user: JwtPayload) {
    const s = await this.prisma.staff.findUnique({ where: { id: user.sub }, select: { name: true } });
    return s?.name ?? null;
  }

  // ── OpenRouter helpers for the setup wizard ───────────────────────────────

  async checkOpenRouterKey(apiKey: string) {
    if (!apiKey?.trim()) throw new BadRequestException('Paste the OpenRouter key');
    try {
      const info = await this.openAi.openRouterKeyInfo(apiKey.trim());
      const models = await this.openAi.listModels(OPENROUTER_BASE_URL, apiKey.trim());
      return {
        ok: true,
        label: info.label,
        // OpenRouter's free models allow 50 requests a day until $10 of credit has been bought, then 1,000.
        freeDailyLimit: info.isFreeTier === false ? 1000 : 50,
        boughtCredit: info.isFreeTier === false,
        freeModels: models.filter((m) => m.free).sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (err) {
      if (err instanceof AiError && err.kind === 'AUTH') throw new BadRequestException('OpenRouter did not accept this key. Check you copied all of it.');
      throw new BadRequestException((err as Error).message);
    }
  }

  async listModels(branchId: string, id: string) {
    const c = await this.find(branchId, id);
    if (c.provider !== 'OPENAI_COMPATIBLE') throw new BadRequestException('Model lists are available for OpenAI-style connections');
    const target = this.router.target(c);
    if (!target) throw new BadRequestException('The saved key can no longer be read. Paste it again.');
    return this.openAi.listModels(c.baseUrl, target.apiKey).catch((err: Error) => {
      throw new BadRequestException(err.message);
    });
  }

  // ── Self-test ─────────────────────────────────────────────────────────────

  /** Starts the exam in the background; admin polls the connection for the score. */
  async startSelfTest(branchId: string, id: string) {
    const c = await this.find(branchId, id);
    if (this.running.has(id)) return { started: false, running: true };
    this.running.add(id);
    void this.runSelfTest(c)
      .catch((err) => this.logger.warn(`Self-test for ${c.name} failed: ${(err as Error).message}`))
      .finally(() => this.running.delete(id));
    return { started: true, running: true, questions: CHAT_SELF_TEST.length + (c.supportsVision ? 2 : 0) };
  }

  private async runSelfTest(c: AiConnection) {
    const branchId = c.branchId;
    const settings = await this.chatbot.getSettings(branchId);
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true, address: true, phone: true, timezone: true, vatEnabled: true, taxRate: true, serviceChargeEnabled: true, serviceChargeRate: true },
    });
    const content = await this.prisma.websiteContent.findUnique({ where: { branchId }, select: { openingHours: true } });
    const ruleRow = await this.prisma.chatRuleVersion.findFirst({ where: { branchId }, orderBy: { createdAt: 'desc' } });
    const rules = Array.isArray(ruleRow?.rules) ? (ruleRow!.rules as unknown[]).map(String) : [];
    const menu = await this.menus.get(branchId);
    const charges = { vatPercent: branch.vatEnabled ? Number(branch.taxRate) : 0, servicePercent: branch.serviceChargeEnabled ? Number(branch.serviceChargeRate) : 0 };
    const system = buildSystemPrompt({
      assistantName: settings.assistantName,
      brand: branch.name,
      address: branch.address,
      phone: branch.phone,
      openingHours: content?.openingHours ?? null,
      siteUrl: this.menus.siteUrl(),
      rules,
      partyRules: settings.partyRules,
      menu,
    });
    const allowed = ownerAmounts(...rules, settings.partyRules);
    const line = contextLine({ now: new Date(), timezone: branch.timezone || 'Asia/Dhaka', phoneOnFile: false, nameOnFile: null });

    const results: SelfTestCaseResult[] = [];
    for (const test of CHAT_SELF_TEST) {
      try {
        // Free models turn away bursts, so each question gets two more tries before it counts as failed.
        const res = await this.router.callWithRetry(c, 'CHAT', { system, messages: [{ role: 'user', content: `${line}\n${test.message}` }] }, { outcome: 'TEST' }, 2);
        results.push(scoreChatCase(test, res.text, parseAiReply(res.text, test.message), menu, charges, allowed, res.latencyMs));
      } catch (err) {
        results.push(scoreChatCase(test, null, null, menu, charges, allowed, null, (err as Error).message.slice(0, 200)));
      }
    }

    if (c.supportsVision) {
      const withPhotos = menu.units.filter((u) => u.imageUrl && /^https?:\/\//.test(u.imageUrl)).slice(0, 12);
      const picks = [withPhotos[0], withPhotos[Math.floor(withPhotos.length / 2)]].filter((u, i, arr) => u && arr.indexOf(u) === i);
      for (const unit of picks) {
        const name = `Photo of ${unit!.name}`;
        try {
          const image = await fetchImage(unit!.imageUrl!);
          const res = await this.router.call(
            c,
            'VISION',
            { system: buildVisionPrompt(branch.name, menu), messages: [{ role: 'user', content: 'Which dish is this?', images: [image] }] },
            { outcome: 'TEST' },
          );
          const matches = parseVisionMatches(res.text, menu);
          const top = matches?.[0] ? menu.byRef.get(matches[0].ref) : null;
          const passed = !!top && (top.itemId === unit!.itemId || top.imageUrl === unit!.imageUrl);
          results.push({ name, passed, note: passed ? null : matches ? `picked ${top?.name ?? 'nothing'}` : 'reply was not in the required format', reply: res.text.slice(0, 200), latencyMs: res.latencyMs });
        } catch (err) {
          results.push({ name, passed: false, note: (err as Error).message.slice(0, 200), reply: null, latencyMs: null });
        }
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const score = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
    const latencies = results.map((r) => r.latencyMs).filter((x): x is number => x != null);
    await this.prisma.aiConnection.update({
      where: { id: c.id },
      data: {
        selfTestScore: score,
        selfTestAt: new Date(),
        selfTestDetail: {
          passed,
          total: results.length,
          avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
          results,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    this.router.invalidate(branchId);
  }

  // ── Usage report ──────────────────────────────────────────────────────────

  async usage(branchId: string, days: number) {
    const since = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 86_400_000);
    const [rows, connections, setting] = await Promise.all([
      this.prisma.aiUsage.groupBy({
        by: ['connectionId', 'outcome'],
        where: { branchId, createdAt: { gte: since } },
        _count: true,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiConnection.findMany({ where: { branchId }, select: { id: true, name: true, model: true } }),
      this.prisma.chatbotSetting.findUnique({ where: { branchId }, select: { usdRate: true } }),
    ]);
    const rate = Number(setting?.usdRate ?? 122);
    const byConnection = new Map<string, { id: string; name: string; model: string; requests: number; ok: number; errors: number; blocked: number; tests: number; costTaka: number; avgLatencyMs: number | null }>();
    for (const r of rows) {
      const c = connections.find((x) => x.id === r.connectionId);
      const entry = byConnection.get(r.connectionId) ?? { id: r.connectionId, name: c?.name ?? 'Removed', model: c?.model ?? '', requests: 0, ok: 0, errors: 0, blocked: 0, tests: 0, costTaka: 0, avgLatencyMs: null };
      entry.requests += r._count;
      if (r.outcome === 'OK' || r.outcome === 'SHADOW') entry.ok += r._count;
      if (r.outcome === 'ERROR') entry.errors += r._count;
      if (r.outcome === 'BLOCKED') entry.blocked += r._count;
      if (r.outcome === 'TEST') entry.tests += r._count;
      entry.costTaka += Number(r._sum.costUsd ?? 0) * rate;
      if (r.outcome === 'OK' && r._avg.latencyMs != null) entry.avgLatencyMs = Math.round(r._avg.latencyMs);
      byConnection.set(r.connectionId, entry);
    }
    return [...byConnection.values()].map((e) => ({ ...e, costTaka: Math.round(e.costTaka * 100) / 100 }));
  }
}

async function fetchImage(url: string): Promise<{ mediaType: AiImageMediaType; data: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not load the menu photo (HTTP ${res.status})`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type) ? type : 'image/jpeg') as AiImageMediaType;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 4_500_000) throw new Error('Menu photo is too large to test with');
  return { mediaType, data: buffer.toString('base64') };
}
