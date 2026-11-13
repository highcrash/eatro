import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConnection, AiJob, AiRoute } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret, secretsKey } from '../secrets';
import { AiError, AiProvider, AiRequest, AiResult, AiTarget } from './ai.types';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

export interface AiRunResult extends AiResult {
  connectionId: string;
}

interface BranchConfig {
  at: number;
  connections: Map<string, AiConnection>;
  routes: Map<AiJob, AiRoute>;
  usdRate: number;
}

const CONFIG_CACHE_MS = 30_000;
const SPEND_CACHE_MS = 60_000;

/** Stable 0-99 bucket per conversation, so a split test keeps one chat on one model. */
export function splitBucket(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 100;
}

/**
 * Chooses which AI connection answers a job and falls through the owner's
 * backup list when one fails, is over its budget, or is out of daily
 * requests. Config is read from the database with a short cache, so a
 * swap in admin applies to the next message without a restart.
 */
@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name);
  private config = new Map<string, BranchConfig>();
  private spend = new Map<string, { at: number; monthUsd: number; today: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: ConfigService,
    private readonly openAi: OpenAiCompatibleProvider,
    private readonly anthropic: AnthropicProvider,
  ) {}

  invalidate(branchId: string) {
    this.config.delete(branchId);
  }

  private key(): Buffer {
    return secretsKey({ SECRETS_KEY: this.env.get<string>('SECRETS_KEY'), JWT_SECRET: this.env.get<string>('JWT_SECRET') });
  }

  private provider(type: AiConnection['provider']): AiProvider {
    return type === 'ANTHROPIC' ? this.anthropic : this.openAi;
  }

  private async load(branchId: string): Promise<BranchConfig> {
    const hit = this.config.get(branchId);
    if (hit && Date.now() - hit.at < CONFIG_CACHE_MS) return hit;
    const [connections, routes, setting] = await Promise.all([
      this.prisma.aiConnection.findMany({ where: { branchId, deletedAt: null } }),
      this.prisma.aiRoute.findMany({ where: { branchId } }),
      this.prisma.chatbotSetting.findUnique({ where: { branchId }, select: { usdRate: true } }),
    ]);
    const fresh: BranchConfig = {
      at: Date.now(),
      connections: new Map(connections.map((c) => [c.id, c])),
      routes: new Map(routes.map((r) => [r.job, r])),
      usdRate: Number(setting?.usdRate ?? 122),
    };
    this.config.set(branchId, fresh);
    return fresh;
  }

  /** Decrypts a connection's key. Null when the key can no longer be read. */
  target(connection: AiConnection): AiTarget | null {
    const apiKey = decryptSecret(connection.apiKeyEnc, this.key());
    if (!apiKey) return null;
    return { provider: connection.provider, baseUrl: connection.baseUrl, apiKey, model: connection.model };
  }

  private async spendOf(connectionId: string) {
    const hit = this.spend.get(connectionId);
    if (hit && Date.now() - hit.at < SPEND_CACHE_MS) return hit;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [month, today] = await Promise.all([
      this.prisma.aiUsage.aggregate({ where: { connectionId, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
      this.prisma.aiUsage.count({ where: { connectionId, createdAt: { gte: dayStart } } }),
    ]);
    const fresh = { at: Date.now(), monthUsd: Number(month._sum.costUsd ?? 0), today };
    this.spend.set(connectionId, fresh);
    return fresh;
  }

  private async available(connection: AiConnection, usdRate: number): Promise<boolean> {
    if (!connection.isActive) return false;
    if (connection.monthlyBudget == null && connection.dailyRequestLimit == null) return true;
    const spend = await this.spendOf(connection.id);
    if (connection.dailyRequestLimit != null && spend.today >= connection.dailyRequestLimit) return false;
    if (connection.monthlyBudget != null && spend.monthUsd * usdRate >= Number(connection.monthlyBudget)) return false;
    return true;
  }

  /** The connections for a job in the order they will be tried. */
  async candidates(branchId: string, job: AiJob, conversationKey?: string): Promise<AiConnection[]> {
    const cfg = await this.load(branchId);
    const route = cfg.routes.get(job);
    if (!route) return [];
    const ids = [...((route.connectionIds as string[] | null) ?? [])];
    if (route.splitConnectionId && route.splitPercent > 0 && conversationKey && splitBucket(conversationKey) < route.splitPercent) {
      ids.unshift(route.splitConnectionId);
    }
    const out: AiConnection[] = [];
    for (const id of [...new Set(ids)]) {
      const connection = cfg.connections.get(id);
      if (!connection) continue;
      if (job === 'VISION' && !connection.supportsVision) continue;
      if (await this.available(connection, cfg.usdRate)) out.push(connection);
    }
    return out;
  }

  async shadowConnection(branchId: string, job: AiJob): Promise<AiConnection | null> {
    const cfg = await this.load(branchId);
    const id = cfg.routes.get(job)?.shadowConnectionId;
    const connection = id ? cfg.connections.get(id) : undefined;
    return connection && (await this.available(connection, cfg.usdRate)) ? connection : null;
  }

  /** One call to one connection, with its usage recorded whatever happens. */
  async call(
    connection: AiConnection,
    job: AiJob,
    request: AiRequest,
    meta: { conversationId?: string | null; outcome?: string } = {},
  ): Promise<AiRunResult> {
    const target = this.target(connection);
    if (!target) throw new AiError('AUTH', 'The saved key for this connection can no longer be read. Paste it again in admin.');
    try {
      const result = await this.provider(connection.provider).complete(target, request);
      await this.record(connection, job, meta.conversationId ?? null, result, meta.outcome ?? 'OK');
      return { ...result, connectionId: connection.id };
    } catch (err) {
      await this.record(connection, job, meta.conversationId ?? null, null, 'ERROR');
      throw err instanceof AiError ? err : new AiError('OTHER', (err as Error).message);
    }
  }

  /**
   * Run a job through the backup list. `accept` lets the caller reject a
   * reply (bad JSON, an invented price) and move on to the next connection.
   * Returns null when no connection produced an acceptable reply.
   */
  async run<T>(
    branchId: string,
    job: AiJob,
    request: AiRequest,
    opts: { conversationId?: string | null; conversationKey?: string; accept: (result: AiRunResult) => T | null; maxAttempts?: number },
  ): Promise<{ value: T; result: AiRunResult } | null> {
    const list = await this.candidates(branchId, job, opts.conversationKey);
    for (const connection of list.slice(0, opts.maxAttempts ?? 3)) {
      try {
        const result = await this.call(connection, job, request, { conversationId: opts.conversationId });
        const value = opts.accept(result);
        if (value != null) return { value, result };
        await this.markBlocked(connection.id, job, opts.conversationId ?? null);
      } catch (err) {
        this.logger.warn(`AI connection "${connection.name}" failed for ${job}: ${(err as Error).message}`);
      }
    }
    return null;
  }

  private async record(connection: AiConnection, job: AiJob, conversationId: string | null, result: AiResult | null, outcome: string) {
    const costUsd = result
      ? (result.inputTokens * Number(connection.inputPricePerM) + result.outputTokens * Number(connection.outputPricePerM)) / 1_000_000
      : 0;
    try {
      await this.prisma.aiUsage.create({
        data: {
          branchId: connection.branchId,
          connectionId: connection.id,
          job,
          conversationId,
          inputTokens: result?.inputTokens ?? 0,
          outputTokens: result?.outputTokens ?? 0,
          costUsd,
          latencyMs: result?.latencyMs ?? 0,
          outcome,
        },
      });
      const cached = this.spend.get(connection.id);
      if (cached) {
        cached.today += 1;
        cached.monthUsd += costUsd;
      }
    } catch (err) {
      this.logger.warn(`Could not record AI usage: ${(err as Error).message}`);
    }
  }

  /** The latest OK call from this connection turned out unusable; relabel it for the reports. */
  private async markBlocked(connectionId: string, job: AiJob, conversationId: string | null) {
    const last = await this.prisma.aiUsage.findFirst({ where: { connectionId, job, conversationId, outcome: 'OK' }, orderBy: { createdAt: 'desc' } });
    if (last) await this.prisma.aiUsage.update({ where: { id: last.id }, data: { outcome: 'BLOCKED' } });
  }
}
