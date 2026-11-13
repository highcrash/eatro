import { Injectable } from '@nestjs/common';

import { AI_MAX_TOKENS, AI_TIMEOUT_MS, AiError, AiProvider, AiRequest, AiResult, AiTarget } from './ai.types';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface ChatCompletion {
  choices?: { message?: { content?: string | { type?: string; text?: string }[] | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

/**
 * Any service that speaks the OpenAI chat-completions format: OpenRouter,
 * OmniRoute, Groq, OpenAI and similar. Native fetch, like the WhatsApp and
 * SMS clients. JSON replies are asked for in the prompt, not through
 * `response_format` or tool calls, because many free models support neither.
 */
@Injectable()
export class OpenAiCompatibleProvider implements AiProvider {
  async complete(target: AiTarget, request: AiRequest): Promise<AiResult> {
    const base = (target.baseUrl || OPENROUTER_BASE_URL).replace(/\/+$/, '');
    const body = {
      model: target.model,
      max_tokens: AI_MAX_TOKENS,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [
                { type: 'text', text: m.content },
                ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
              ]
            : m.content,
        })),
      ],
    };

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter shows these on the account's activity page; other services ignore them.
          'HTTP-Referer': 'https://eatrobd.com',
          'X-Title': 'EATRO Assistant',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AiError('NETWORK', `Could not reach the AI service: ${(err as Error).message}`);
    }

    const raw = await res.text();
    let json: ChatCompletion | null = null;
    try {
      json = raw ? (JSON.parse(raw) as ChatCompletion) : null;
    } catch {
      /* handled below */
    }

    // OpenRouter can report an upstream failure inside a 200 response.
    const status = res.ok ? Number(json?.error?.code) || res.status : res.status;
    if (!res.ok || json?.error) {
      const message = json?.error?.message ?? (raw.slice(0, 200) || `HTTP ${res.status}`);
      if (status === 429) throw new AiError('RATE_LIMIT', message, status);
      if (status === 401 || status === 403) throw new AiError('AUTH', message, status);
      throw new AiError('OTHER', message, status);
    }

    const content = json?.choices?.[0]?.message?.content;
    const text = (Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content ?? '').trim();
    if (!text) throw new AiError('BAD_RESPONSE', 'The AI service returned an empty reply');
    return {
      text,
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }

  /** Models a key can use, for the "pick a model" list in admin. */
  async listModels(baseUrl: string | null, apiKey: string): Promise<{ id: string; name: string; free: boolean; vision: boolean; contextLength: number | null }[]> {
    const base = (baseUrl || OPENROUTER_BASE_URL).replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new AiError('NETWORK', `Could not reach the AI service: ${(err as Error).message}`);
    }
    if (!res.ok) throw new AiError(res.status === 401 || res.status === 403 ? 'AUTH' : 'OTHER', `Model list failed (HTTP ${res.status})`, res.status);
    const json = (await res.json().catch(() => null)) as {
      data?: { id?: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { input_modalities?: string[] } }[];
    } | null;
    return (json?.data ?? [])
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({
        id: m.id!,
        name: m.name ?? m.id!,
        free: m.id!.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0),
        vision: (m.architecture?.input_modalities ?? []).includes('image'),
        contextLength: m.context_length ?? null,
      }));
  }

  /** OpenRouter only: is the key valid, and has the account bought credit (which lifts the free daily cap)? */
  async openRouterKeyInfo(apiKey: string): Promise<{ label: string | null; isFreeTier: boolean | null; usage: number | null; limit: number | null }> {
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new AiError('NETWORK', `Could not reach OpenRouter: ${(err as Error).message}`);
    }
    if (!res.ok) throw new AiError(res.status === 401 || res.status === 403 ? 'AUTH' : 'OTHER', 'OpenRouter did not accept this key', res.status);
    const json = (await res.json().catch(() => null)) as { data?: { label?: string; is_free_tier?: boolean; usage?: number; limit?: number | null } } | null;
    return {
      label: json?.data?.label ?? null,
      isFreeTier: json?.data?.is_free_tier ?? null,
      usage: json?.data?.usage ?? null,
      limit: json?.data?.limit ?? null,
    };
  }
}
