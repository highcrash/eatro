export type AiImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface AiImage {
  mediaType: AiImageMediaType;
  /** Base64 without the data: prefix. */
  data: string;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AiImage[];
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
}

export interface AiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** A connection with its key decrypted, ready to call. */
export interface AiTarget {
  provider: 'OPENAI_COMPATIBLE' | 'ANTHROPIC';
  baseUrl: string | null;
  apiKey: string;
  model: string;
}

export type AiErrorKind = 'RATE_LIMIT' | 'AUTH' | 'REFUSAL' | 'BAD_RESPONSE' | 'NETWORK' | 'OTHER';

/** Any failure to get text back. The router moves on to the next connection. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface AiProvider {
  complete(target: AiTarget, request: AiRequest): Promise<AiResult>;
}

export const AI_TIMEOUT_MS = 45_000;
/** Replies are short; this leaves room for a model's own reasoning tokens. */
export const AI_MAX_TOKENS = 4096;
