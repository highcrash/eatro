import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';

import { AI_MAX_TOKENS, AI_TIMEOUT_MS, AiError, AiProvider, AiRequest, AiResult, AiTarget } from './ai.types';

/** Claude through Anthropic's own API and official SDK. The model id comes from the connection. */
@Injectable()
export class AnthropicProvider implements AiProvider {
  async complete(target: AiTarget, request: AiRequest): Promise<AiResult> {
    const client = new Anthropic({ apiKey: target.apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            ...m.images.map((img): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
            { type: 'text' as const, text: m.content },
          ]
        : m.content,
    }));

    const started = Date.now();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({ model: target.model, max_tokens: AI_MAX_TOKENS, system: request.system, messages });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiError('AUTH', err.message, err.status);
      }
      if (err instanceof Anthropic.RateLimitError) throw new AiError('RATE_LIMIT', err.message, err.status);
      if (err instanceof Anthropic.APIConnectionError) throw new AiError('NETWORK', err.message);
      if (err instanceof Anthropic.APIError) throw new AiError('OTHER', err.message, err.status);
      throw new AiError('OTHER', (err as Error).message);
    }

    if (response.stop_reason === 'refusal') throw new AiError('REFUSAL', 'The model declined to answer this message');
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (!text) throw new AiError('BAD_RESPONSE', 'The model returned an empty reply');
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  }
}
