import type { AiImage, AiImageMediaType } from './ai/ai.types';

export const MAX_PHOTO_BYTES = 4_500_000;

/** A photo for the AI, or null when it can't be fetched or is too big. */
export async function downloadImage(url: string): Promise<AiImage | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) return null;
  const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type) ? type : 'image/jpeg') as AiImageMediaType;
  return { mediaType, data: buf.toString('base64') };
}
