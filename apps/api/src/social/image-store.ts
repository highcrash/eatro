import { Injectable, Logger } from '@nestjs/common';
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Tiny image-bytes store for the social-post pipeline.
 *
 * The user-facing /upload/image endpoint uses multer + multer-s3 with
 * HTTP file uploads, which doesn't expose a function to drop arbitrary
 * Buffers from the auto-post pipeline. This service does the same env
 * detection (Spaces in prod, local disk in dev) but takes a Buffer
 * directly. Mirrors the storage convention so backups + cleanup
 * scripts already know where the files live.
 */

const SPACES_BUCKET = process.env.SPACES_BUCKET ?? '';
const SPACES_KEY = process.env.SPACES_KEY ?? '';
const SPACES_SECRET = process.env.SPACES_SECRET ?? '';
const SPACES_REGION = process.env.SPACES_REGION ?? 'sgp1';
const SPACES_ENDPOINT = process.env.SPACES_ENDPOINT ?? `https://${SPACES_REGION}.digitaloceanspaces.com`;
const SPACES_PUBLIC_BASE = process.env.SPACES_PUBLIC_BASE ?? `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com`;
const useSpaces = Boolean(SPACES_BUCKET && SPACES_KEY && SPACES_SECRET);

const LOCAL_DIR = join(process.cwd(), 'apps', 'api', 'uploads', 'social');

@Injectable()
export class SocialImageStore {
  private readonly log = new Logger(SocialImageStore.name);
  private readonly s3 = useSpaces
    ? new S3Client({
        region: SPACES_REGION,
        endpoint: SPACES_ENDPOINT,
        forcePathStyle: false,
        credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET },
      })
    : null;

  /** Persist a JPEG buffer for a scheduled post. Returns:
   *  - `path` — what we save in the DB (s3 key OR local relative path)
   *  - `url`  — public URL for previews / "View image" links */
  async save(postId: string, buffer: Buffer): Promise<{ path: string; url: string }> {
    if (this.s3) {
      const key = `social/${postId}.jpg`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: SPACES_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: 'image/jpeg',
          ACL: 'public-read',
        }),
      );
      return { path: key, url: `${SPACES_PUBLIC_BASE}/${key}` };
    }
    // Local disk fallback (dev). The /uploads route already serves
    // these statically.
    await mkdir(LOCAL_DIR, { recursive: true });
    const filename = `${postId}.jpg`;
    const fullPath = join(LOCAL_DIR, filename);
    await writeFile(fullPath, buffer);
    const relPath = `uploads/social/${filename}`;
    return { path: relPath, url: `/${relPath}` };
  }

  /** Read a stored image back into memory — used by the cron worker
   *  before posting to Facebook, and by the admin preview endpoint. */
  async read(path: string): Promise<Buffer> {
    if (this.s3 && !path.startsWith('uploads/')) {
      // Spaces key — fetch via public URL (simpler than GetObject + stream).
      const res = await fetch(`${SPACES_PUBLIC_BASE}/${path}`);
      if (!res.ok) throw new Error(`Failed to read social image ${path}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    const fullPath = join(process.cwd(), 'apps', 'api', path);
    return readFile(fullPath);
  }

  /** Delete a stored image. Used by the cleanup scope + admin cancel
   *  flows. Best-effort: a missing file is not an error. */
  async remove(path: string): Promise<void> {
    try {
      if (this.s3 && !path.startsWith('uploads/')) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: path }));
      } else {
        const fullPath = join(process.cwd(), 'apps', 'api', path);
        await unlink(fullPath).catch(() => undefined);
      }
    } catch (err) {
      this.log.warn(`Failed to remove social image ${path}: ${(err as Error).message}`);
    }
  }
}
