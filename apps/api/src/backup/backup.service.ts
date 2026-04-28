import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { promises as fs } from 'fs';
import { Readable } from 'stream';
import { join } from 'path';
import { gzip as gzipCb, gunzip as gunzipCb } from 'zlib';
import { promisify } from 'util';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { BACKUP_MODELS, BACKUP_FILE_VERSION } from './backup.constants';

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

// Best-effort local disk cache. Container filesystems on hosts like
// DigitalOcean App Platform are ephemeral, so the DB column on
// BackupRecord is the source of truth — disk is just a convenience
// for local dev. Writes that fail (read-only fs, no space) are
// swallowed; reads fall back to the DB column.
const BACKUP_DIR = join(process.cwd(), 'apps', 'api', 'backups');

// ─── DO Spaces (S3-compatible) — secondary backup location ──────────────────
// Same SPACES_* env vars as the upload module. Backups upload with
// ACL=private (sensitive data — full DB dump including staff hashes).
// Read order is DB → Spaces → disk so a single store going dark doesn't
// kill recovery. Spaces upload failure is logged but never aborts the
// backup — the DB copy is the source of truth.
const SPACES_BUCKET = process.env.SPACES_BUCKET ?? '';
const SPACES_KEY = process.env.SPACES_KEY ?? '';
const SPACES_SECRET = process.env.SPACES_SECRET ?? '';
const SPACES_REGION = process.env.SPACES_REGION ?? 'sgp1';
const SPACES_ENDPOINT = process.env.SPACES_ENDPOINT ?? `https://${SPACES_REGION}.digitaloceanspaces.com`;
const SPACES_BACKUP_PREFIX = process.env.SPACES_BACKUP_PREFIX ?? 'backups';
const spacesEnabled = Boolean(SPACES_BUCKET && SPACES_KEY && SPACES_SECRET);
const spacesClient: S3Client | null = spacesEnabled
  ? new S3Client({
      region: SPACES_REGION,
      endpoint: SPACES_ENDPOINT,
      forcePathStyle: false,
      credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET },
    })
  : null;

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {
    this.ensureDir().catch((e) => this.logger.error(`Failed to create backup dir: ${e.message}`));
  }

  private async ensureDir() {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  }

  /** Best-effort write to local disk — failure is non-fatal because the
   *  payload also lives in the DB. Used so local dev still gets a file
   *  on disk for inspection / manual download. */
  private async tryWriteDisk(filename: string, buf: Buffer) {
    try {
      await this.ensureDir();
      await fs.writeFile(join(BACKUP_DIR, filename), buf);
    } catch (e) {
      this.logger.warn(`Disk cache write failed for ${filename}: ${(e as Error).message} (DB copy is the source of truth)`);
    }
  }

  /** Best-effort upload to DO Spaces. Returns the object key on success
   *  so the caller can persist it on the BackupRecord; null on failure
   *  (logged) — the DB column is still the source of truth. ACL=private
   *  because backups contain full branch data including password hashes. */
  private async tryUploadSpaces(filename: string, buf: Buffer): Promise<string | null> {
    if (!spacesClient) return null;
    const key = `${SPACES_BACKUP_PREFIX}/${filename}`;
    try {
      await spacesClient.send(new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: buf,
        ContentType: 'application/gzip',
        ACL: 'private',
      }));
      return key;
    } catch (e) {
      this.logger.warn(`Spaces upload failed for ${filename}: ${(e as Error).message} (DB copy is the source of truth)`);
      return null;
    }
  }

  /** Pull a backup back from Spaces. Returns null if Spaces is not
   *  configured, the key is missing, or the fetch fails — caller falls
   *  back to disk in that case. */
  private async tryReadSpaces(spacesKey: string | null): Promise<Buffer | null> {
    if (!spacesClient || !spacesKey) return null;
    try {
      const out = await spacesClient.send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: spacesKey }));
      if (!out.Body) return null;
      return await streamToBuffer(out.Body as NodeJS.ReadableStream);
    } catch (e) {
      this.logger.warn(`Spaces read failed for ${spacesKey}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Best-effort delete from Spaces — never throws so a stale-key
   *  delete doesn't block removing the BackupRecord row. */
  private async tryDeleteSpaces(spacesKey: string | null) {
    if (!spacesClient || !spacesKey) return;
    try {
      await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: spacesKey }));
    } catch (e) {
      this.logger.warn(`Spaces delete failed for ${spacesKey}: ${(e as Error).message}`);
    }
  }

  /* ── LIST ─────────────────────────────────────────────────────── */
  async list() {
    return this.prisma.backupRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /* ── SCHEDULE ─────────────────────────────────────────────────── */
  async getSchedule() {
    let s = await this.prisma.backupSchedule.findUnique({ where: { id: 'default' } });
    if (!s) {
      s = await this.prisma.backupSchedule.create({ data: { id: 'default' } });
    }
    return s;
  }

  async updateSchedule(dto: { frequency?: string; timeHour?: number; retention?: number }) {
    const { frequency, timeHour, retention } = dto;
    if (frequency && !['OFF', 'DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency)) {
      throw new BadRequestException('Invalid frequency');
    }
    if (timeHour != null && (timeHour < 0 || timeHour > 23)) {
      throw new BadRequestException('timeHour must be 0-23');
    }
    if (retention != null && (retention < 1 || retention > 365)) {
      throw new BadRequestException('retention must be 1-365');
    }
    await this.getSchedule();
    return this.prisma.backupSchedule.update({
      where: { id: 'default' },
      data: {
        ...(frequency != null ? { frequency } : {}),
        ...(timeHour != null ? { timeHour } : {}),
        ...(retention != null ? { retention } : {}),
      },
    });
  }

  /* ── CREATE BACKUP ────────────────────────────────────────────── */
  async createBackup(type: 'MANUAL' | 'AUTO', createdById?: string) {
    await this.ensureDir();

    const data: Record<string, unknown[]> = {};
    for (const m of BACKUP_MODELS) {
      // The generated Prisma client might be older than the BACKUP_MODELS
      // list (e.g. after a schema add without re-running `prisma generate`
      // on the deployed server). Skip missing accessors with a warning
      // rather than crashing the entire backup — the other models still
      // get saved. On the next server redeploy + client regen the missing
      // model joins the backup automatically.
      const delegate = (this.prisma as any)[m.accessor];
      if (!delegate || typeof delegate.findMany !== 'function') {
        this.logger.warn(`Skipping ${m.accessor} — accessor not on this Prisma client. Run \`prisma generate\` to include it in future backups.`);
        data[m.accessor] = [];
        continue;
      }
      data[m.accessor] = await delegate.findMany();
    }

    const payload = {
      version: BACKUP_FILE_VERSION,
      createdAt: new Date().toISOString(),
      type,
      data,
    };
    const json = JSON.stringify(payload);
    const compressed = await gzip(Buffer.from(json, 'utf8'));

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${type.toLowerCase()}-${ts}.json.gz`;
    // Triple-store: DB column (source of truth) + DO Spaces (durable
    // off-host) + local disk (best-effort dev convenience). Both extras
    // can fail independently without blocking the backup itself.
    const [, spacesKey] = await Promise.all([
      this.tryWriteDisk(filename, compressed),
      this.tryUploadSpaces(filename, compressed),
    ]);

    const record = await this.prisma.backupRecord.create({
      data: {
        filename,
        fileUrl: `backups/${filename}`,
        sizeBytes: compressed.length,
        type,
        data: compressed,
        spacesKey: spacesKey ?? null,
        createdById: createdById ?? null,
      },
    });

    if (type === 'AUTO') await this.pruneAutoBackups();
    this.logger.log(`Backup created: ${filename} (${(compressed.length / 1024).toFixed(1)} KB)`);
    return record;
  }

  /** Persist an uploaded .json.gz file as a BackupRecord (type UPLOAD).
   *  Validates the file is a readable gzipped JSON backup before saving. */
  async storeUploadedFile(file: Express.Multer.File, createdById?: string) {
    // Quick validation — must decompress and parse, and have our expected shape.
    try {
      const decompressed = await gunzip(file.buffer);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      if (!parsed?.version || !parsed?.data || typeof parsed.data !== 'object') {
        throw new Error('missing version/data fields');
      }
    } catch (e) {
      throw new BadRequestException(`Not a valid backup file: ${(e as Error).message}`);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const filename = `backup-upload-${ts}-${safeName}`;
    const [, spacesKey] = await Promise.all([
      this.tryWriteDisk(filename, file.buffer),
      this.tryUploadSpaces(filename, file.buffer),
    ]);

    const record = await this.prisma.backupRecord.create({
      data: {
        filename,
        fileUrl: `backups/${filename}`,
        sizeBytes: file.buffer.length,
        type: 'UPLOAD',
        data: file.buffer,
        spacesKey: spacesKey ?? null,
        createdById: createdById ?? null,
      },
    });
    this.logger.log(`Uploaded backup stored: ${filename} (${(file.buffer.length / 1024).toFixed(1)} KB)`);
    return record;
  }

  private async pruneAutoBackups() {
    const schedule = await this.getSchedule();
    const keep = schedule.retention;
    const autos = await this.prisma.backupRecord.findMany({
      where: { type: 'AUTO' },
      orderBy: { createdAt: 'desc' },
    });
    const toDelete = autos.slice(keep);
    for (const r of toDelete) {
      await this.deleteBackup(r.id).catch((e) => this.logger.warn(`Prune failed for ${r.id}: ${e.message}`));
    }
  }

  /* ── DELETE ───────────────────────────────────────────────────── */
  async deleteBackup(id: string) {
    const rec = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Backup not found');
    // Best-effort cleanup of disk + Spaces; failures don't block the
    // DB row removal so a stale key doesn't strand the record.
    const fullPath = join(BACKUP_DIR, rec.filename);
    await fs.unlink(fullPath).catch(() => { /* file already gone */ });
    await this.tryDeleteSpaces((rec as { spacesKey?: string | null }).spacesKey ?? null);
    await this.prisma.backupRecord.delete({ where: { id } });
    return { success: true };
  }

  /* ── DOWNLOAD PATH ────────────────────────────────────────────── */
  /** Read order: DB column → DO Spaces → local disk. Survives losing
   *  any single store. The DB column is preferred (cheapest, lowest
   *  latency); Spaces and disk only consulted when the DB copy is
   *  null (legacy rows or pre-migration data). */
  async getDownloadStream(id: string) {
    const rec = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Backup not found');

    const recExt = rec as { data?: Buffer | null; spacesKey?: string | null };
    const dataBuf: Buffer | null = recExt.data ?? null;
    if (dataBuf) {
      return { stream: Readable.from(dataBuf), filename: rec.filename, sizeBytes: dataBuf.length };
    }

    const fromSpaces = await this.tryReadSpaces(recExt.spacesKey ?? null);
    if (fromSpaces) {
      return { stream: Readable.from(fromSpaces), filename: rec.filename, sizeBytes: fromSpaces.length };
    }

    // Legacy disk fallback — rows created before the data column
    // shipped. On ephemeral hosts these are effectively orphans after
    // any container restart.
    try {
      const fullPath = join(BACKUP_DIR, rec.filename);
      const buf = await fs.readFile(fullPath);
      return { stream: Readable.from(buf), filename: rec.filename, sizeBytes: rec.sizeBytes };
    } catch {
      throw new NotFoundException('Backup file unavailable in DB, Spaces, or local disk. Create a new backup.');
    }
  }

  /* ── RESTORE ──────────────────────────────────────────────────── */
  /**
   * Restore from a previously created backup record OR from an uploaded file.
   * Requires owner password confirmation.
   */
  async restore(opts: { recordId?: string; uploadedFile?: Express.Multer.File; ownerId: string; password: string }) {
    const owner = await this.prisma.staff.findFirst({
      where: { id: opts.ownerId, role: 'OWNER', deletedAt: null, isActive: true },
    });
    if (!owner) throw new UnauthorizedException('Owner account not found');
    const ok = await bcrypt.compare(opts.password, owner.passwordHash);
    if (!ok) throw new UnauthorizedException('Incorrect password');

    let compressed: Buffer;
    if (opts.recordId) {
      const rec = await this.prisma.backupRecord.findUnique({ where: { id: opts.recordId } });
      if (!rec) throw new NotFoundException('Backup not found');
      const recExt = rec as { data?: Buffer | null; spacesKey?: string | null };
      const dataBuf = recExt.data ?? null;
      if (dataBuf) {
        compressed = dataBuf;
      } else {
        const fromSpaces = await this.tryReadSpaces(recExt.spacesKey ?? null);
        if (fromSpaces) {
          compressed = fromSpaces;
        } else {
          // Final disk fallback for rows that pre-date both DB + Spaces.
          try {
            compressed = await fs.readFile(join(BACKUP_DIR, rec.filename));
          } catch {
            throw new NotFoundException('Backup file unavailable in DB, Spaces, or local disk. Upload the .json.gz file instead.');
          }
        }
      }
    } else if (opts.uploadedFile) {
      compressed = opts.uploadedFile.buffer;
    } else {
      throw new BadRequestException('No backup source provided');
    }

    let decompressed: Buffer;
    try {
      decompressed = await gunzip(compressed);
    } catch (e) {
      throw new BadRequestException(`Cannot decompress backup: ${(e as Error).message}`);
    }

    let payload: { version: number; data: Record<string, any[]> };
    try {
      payload = JSON.parse(decompressed.toString('utf8'));
    } catch (e) {
      throw new BadRequestException(`Backup file is not valid JSON: ${(e as Error).message}`);
    }

    if (!payload.version || payload.version > BACKUP_FILE_VERSION) {
      throw new BadRequestException(`Unsupported backup version: ${payload.version}`);
    }
    if (!payload.data || typeof payload.data !== 'object') {
      throw new BadRequestException('Invalid backup payload');
    }

    await this.applyRestore(payload.data);
    this.logger.warn(`Database restored by owner ${opts.ownerId}`);
    return { success: true, restored: Object.fromEntries(BACKUP_MODELS.map((m) => [m.accessor, payload.data[m.accessor]?.length ?? 0])) };
  }

  /**
   * Internal restore — used by the in-app updater's rollback path.
   * Skips the OWNER password check that the public restore() requires,
   * because the updater has already authenticated + authorized the
   * caller at the controller layer (OWNER role + JWT). Not exposed via
   * any HTTP route.
   */
  async restoreFromBackupId(recordId: string): Promise<void> {
    const rec = await this.prisma.backupRecord.findUnique({ where: { id: recordId } });
    if (!rec) throw new NotFoundException(`Backup ${recordId} not found`);
    const compressed = await fs.readFile(join(BACKUP_DIR, rec.filename));
    const decompressed = await gunzip(compressed);
    const payload = JSON.parse(decompressed.toString('utf8')) as { version: number; data: Record<string, any[]> };
    if (!payload.version || payload.version > BACKUP_FILE_VERSION) {
      throw new BadRequestException(`Unsupported backup version: ${payload.version}`);
    }
    await this.applyRestore(payload.data);
    this.logger.warn(`Database restored from backup ${recordId} (internal — no password check)`);
  }

  private async applyRestore(data: Record<string, any[]>) {
    // TRUNCATE only the tables the deployed Prisma client knows about —
    // otherwise a stale client trying to truncate a table it doesn't
    // recognise would surface as a confusing error when the real fix
    // is a `prisma generate` re-run.
    const truncatable = BACKUP_MODELS.filter((m) => {
      const delegate = (this.prisma as any)[m.accessor];
      return delegate && typeof delegate.createMany === 'function';
    });
    const tables = truncatable.map((m) => `"${m.table}"`).join(', ');
    try {
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    } catch (e) {
      throw new BadRequestException(`TRUNCATE failed: ${(e as Error).message}`);
    }

    for (const m of BACKUP_MODELS) {
      const rows = data[m.accessor];
      if (!rows || rows.length === 0) continue;
      const delegate = (this.prisma as any)[m.accessor];
      if (!delegate || typeof delegate.createMany !== 'function') {
        this.logger.warn(`Skipping restore of ${m.accessor} — accessor not on this Prisma client.`);
        continue;
      }
      const prepared = this.prepareRows(rows);
      try {
        if (m.hasSelfRef) {
          const roots = prepared.filter((r: any) => r.parentId == null);
          const kids = prepared.filter((r: any) => r.parentId != null);
          if (roots.length) await delegate.createMany({ data: roots, skipDuplicates: true });
          if (kids.length) await delegate.createMany({ data: kids, skipDuplicates: true });
        } else {
          const CHUNK = 1000;
          for (let i = 0; i < prepared.length; i += CHUNK) {
            await delegate.createMany({
              data: prepared.slice(i, i + CHUNK),
              skipDuplicates: true,
            });
          }
        }
      } catch (e) {
        const sample = prepared[0] ? JSON.stringify(prepared[0]).slice(0, 500) : '(none)';
        this.logger.error(`Insert failed for ${m.accessor}: ${(e as Error).message}. Sample row: ${sample}`);
        throw new BadRequestException(
          `Restore failed at model "${m.accessor}" (table ${m.table}): ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Coerce values from JSON back into types Prisma createMany accepts:
   *   - ISO date strings → Date
   *   - Prisma Decimal objects (deserialized as numbers/strings) → pass through
   *   - null → null (kept as-is for optional fields)
   */
  private prepareRows(rows: any[]): any[] {
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
    return rows.map((row) => {
      const out: any = {};
      for (const k of Object.keys(row)) {
        const v = row[k];
        if (typeof v === 'string' && ISO.test(v)) {
          out[k] = new Date(v);
        } else {
          out[k] = v;
        }
      }
      return out;
    });
  }
}
