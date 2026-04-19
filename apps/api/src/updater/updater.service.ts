import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from '../backup/backup.service';
import { UPDATER_CONSTANTS } from './updater.constants';
import { verifyRelease, type Manifest } from './updater.verify';

/**
 * Drives the admin UI's Settings → Updates tab. Three public entry
 * points:
 *
 *   stageUpload()  — save the uploaded zip to disk, extract, verify
 *                    signature + manifest hashes, create the
 *                    UpdateRecord row. Returns before applying so the
 *                    buyer can review version + notes first.
 *   applyStaged()  — pre-apply DB backup (reuses BackupService), swap
 *                    current/ ↔ staging/, run `prisma migrate deploy`,
 *                    write apply marker, exit(0) so PM2 restarts us
 *                    pointing at the new dist.
 *   rollback()     — swap back, restore DB from the pre-apply backup,
 *                    exit(0).
 *
 * Filesystem layout inside the install root:
 *   /updates/staging/<updateId>/   — extracted zip, pending apply
 *   /updates/prev/                 — last pre-apply snapshot (one only)
 *   /updates/archive/<updateId>.zip — original uploaded zip (kept)
 *   /updates/apply-on-boot.json    — written by applyStaged() just
 *                                    before exit; read on next boot
 *                                    to finalize the swap status row.
 *
 * Why the exit-then-PM2-restart dance: the running Node process
 * holds file descriptors into its own dist/. Renaming the dir works
 * on Linux (inodes stay live) but the RUNNING process keeps serving
 * old code until it exits. PM2's autorestart picks up the new tree
 * on next start. The swap happens BEFORE exit so PM2 starts fresh.
 */
@Injectable()
export class UpdaterService {
  private readonly logger = new Logger(UpdaterService.name);
  private readonly installRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
  ) {
    // The API runs from api/dist/, two levels under the install root.
    // Resolve relative to process.cwd() — the install.sh starts PM2
    // with `--cwd /opt/restaurant-pos/` so cwd is the install root.
    this.installRoot = resolve(process.cwd());
  }

  async history(limit = 20) {
    return this.prisma.updateRecord.findMany({
      take: limit,
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Called from the controller with the multer file object. Saves the
   * zip to archive/, extracts to staging/, verifies, creates the DB
   * row. Returns the row.
   */
  async stageUpload(params: {
    zipBuffer: Buffer;
    originalName: string;
    uploadedById: string | null;
  }) {
    const updateId = generateId();
    const stagingPath = join(this.installRoot, UPDATER_CONSTANTS.stagingDir, updateId);
    const archivePath = join(this.installRoot, UPDATER_CONSTANTS.archiveDir, `${updateId}.zip`);

    await mkdir(stagingPath, { recursive: true });
    await mkdir(join(this.installRoot, UPDATER_CONSTANTS.archiveDir), { recursive: true });

    // Archive the original zip first — if verification later fails we
    // still have the file for support triage. Copied, not renamed,
    // because multer already wrote it to /tmp and we don't own that.
    await writeFile(archivePath, params.zipBuffer);

    // sha256 over the raw zip — used as idempotency key if the buyer
    // accidentally re-uploads the same zip twice. We don't block
    // re-uploads, just annotate the row.
    const zipSha256 = createHash('sha256').update(params.zipBuffer).digest('hex');

    // Extract. node:zlib doesn't do zip; shell out to `unzip`. Every
    // install.sh path installs unzip already; if it's missing the
    // buyer's install is broken anyway.
    try {
      await this.unzipTo(archivePath, stagingPath);
    } catch (err) {
      await rm(stagingPath, { recursive: true, force: true });
      throw new BadRequestException(`Failed to extract zip: ${(err as Error).message}`);
    }

    // Verify signature + file hashes.
    let manifest: Manifest;
    try {
      manifest = await verifyRelease(stagingPath, UPDATER_CONSTANTS.signingPublicKey);
    } catch (err) {
      await rm(stagingPath, { recursive: true, force: true });
      // Record the failed attempt for audit — the buyer will want
      // to know WHY their zip was rejected, not just that it was.
      await this.prisma.updateRecord.create({
        data: {
          id: updateId,
          toVersion: 'unknown',
          fromVersion: await this.currentVersion(),
          status: 'FAILED',
          stagingPath,
          zipSha256,
          notes: `Verification failed: ${(err as Error).message}`,
          uploadedById: params.uploadedById,
        },
      });
      throw new BadRequestException((err as Error).message);
    }

    const fromVersion = await this.currentVersion();
    const row = await this.prisma.updateRecord.create({
      data: {
        id: updateId,
        toVersion: manifest.version,
        fromVersion,
        status: 'STAGED',
        stagingPath,
        zipSha256,
        notes: null,
        uploadedById: params.uploadedById,
      },
    });

    this.logger.log(`staged update ${updateId}: ${fromVersion} → ${manifest.version}`);
    return row;
  }

  /**
   * Swap + migrate + exit. Not async in the usual sense — the last
   * thing it does is process.exit(0) after telling PM2 it's done.
   * Returns a promise that resolves JUST BEFORE the exit so the
   * controller can send the HTTP response.
   */
  async applyStaged(updateId: string, notes?: string): Promise<{ message: string }> {
    const row = await this.prisma.updateRecord.findUnique({ where: { id: updateId } });
    if (!row) throw new NotFoundException('Update record not found');
    if (row.status !== 'STAGED') {
      throw new BadRequestException(`Update is in state ${row.status}, expected STAGED`);
    }

    await this.prisma.updateRecord.update({
      where: { id: updateId },
      data: { status: 'APPLYING', notes: notes ?? null },
    });

    // 1. Pre-apply DB backup.
    this.logger.log(`apply ${updateId}: creating pre-apply DB backup…`);
    const backup = await this.backup.createBackup('MANUAL', row.uploadedById ?? undefined);
    await this.prisma.updateRecord.update({
      where: { id: updateId },
      data: { backupRecordId: backup.id },
    });

    // 2. Atomic file swap. Ordering matters:
    //    (a) move current api/ to prev/api
    //    (b) move staging/<id>/api to current/api
    //    (c) same for admin/ pos/ kds/ qr-order/ web/ prisma/
    //    (d) write apply-on-boot.json for the next process to read
    //    (e) exit — PM2 restarts, boots the new api/
    const prevBase = join(this.installRoot, UPDATER_CONSTANTS.previousDir);
    await rm(prevBase, { recursive: true, force: true });
    await mkdir(prevBase, { recursive: true });

    const appDirs = ['api', 'admin', 'pos', 'kds', 'qr-order', 'web', 'prisma', 'packages'];
    for (const dir of appDirs) {
      const current = join(this.installRoot, dir);
      const staged = join(row.stagingPath, dir);
      const prev = join(prevBase, dir);
      if (!existsSync(staged)) continue; // release may not ship every dir
      if (existsSync(current)) {
        await rename(current, prev).catch(() => { /* first-time dirs may not exist */ });
      }
      await rename(staged, current);
    }

    // 3. Leave a breadcrumb the new process will read on boot so its
    //    UpdaterBootCheck can mark the row APPLIED + start the
    //    health watchdog.
    await writeFile(
      join(this.installRoot, 'updates/apply-on-boot.json'),
      JSON.stringify({
        updateId,
        backupRecordId: backup.id,
        appliedAt: new Date().toISOString(),
      }, null, 2),
    );

    // 4. Hand off to PM2. Exit with code 0 so PM2 treats this as a
    //    clean restart (not a crash). The response has already been
    //    sent from the controller by the time this fires.
    setTimeout(() => {
      this.logger.warn(`apply ${updateId}: exiting so PM2 restarts into new dist…`);
      process.exit(0);
    }, 500);

    return { message: 'Update applied — the server is restarting. Page will reconnect in ~10 seconds.' };
  }

  /**
   * Rollback: symmetric to applyStaged(). Only available while the
   * row is in state APPLIED (not STAGED — there's nothing to roll
   * back) and `prev/` still exists.
   */
  async rollback(updateId: string): Promise<{ message: string }> {
    const row = await this.prisma.updateRecord.findUnique({ where: { id: updateId } });
    if (!row) throw new NotFoundException('Update record not found');
    if (row.status !== 'APPLIED') {
      throw new BadRequestException(`Can only roll back APPLIED updates; row is ${row.status}`);
    }
    const prevBase = join(this.installRoot, UPDATER_CONSTANTS.previousDir);
    if (!existsSync(prevBase)) {
      throw new BadRequestException('Previous version tree has been cleaned up — rollback not possible.');
    }

    // 1. Restore DB. Calls BackupService's internal restore path
    // (no password check — the controller already enforced JWT + OWNER).
    if (row.backupRecordId) {
      this.logger.log(`rollback ${updateId}: restoring DB from backup ${row.backupRecordId}…`);
      await this.backup.restoreFromBackupId(row.backupRecordId).catch((err) => {
        this.logger.error(`rollback DB restore failed: ${err.message}`);
        throw new BadRequestException(
          `DB restore failed: ${err.message}. File swap aborted; the install remains on the new version.`,
        );
      });
    }

    // 2. Swap prev/ → current/
    const appDirs = ['api', 'admin', 'pos', 'kds', 'qr-order', 'web', 'prisma', 'packages'];
    const swapTemp = join(this.installRoot, 'updates/swap-tmp');
    await rm(swapTemp, { recursive: true, force: true });
    await mkdir(swapTemp, { recursive: true });
    for (const dir of appDirs) {
      const current = join(this.installRoot, dir);
      const prev = join(prevBase, dir);
      const temp = join(swapTemp, dir);
      if (!existsSync(prev)) continue;
      if (existsSync(current)) await rename(current, temp).catch(() => undefined);
      await rename(prev, current);
    }

    await this.prisma.updateRecord.update({
      where: { id: updateId },
      data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
    });

    setTimeout(() => {
      this.logger.warn(`rollback ${updateId}: exiting so PM2 restarts into prev dist…`);
      process.exit(0);
    }, 500);

    return { message: 'Rollback applied — server is restarting.' };
  }

  /**
   * Called once at API boot (see UpdaterModule.onApplicationBootstrap).
   * If apply-on-boot.json is present, we're the fresh process
   * replacing the one that applied the update — mark the row APPLIED
   * and clean up the marker. Also prunes the prev/ dir from TWO
   * updates ago (we keep one rollback target).
   */
  async finalizeBootIfPending(): Promise<void> {
    const markerPath = join(this.installRoot, 'updates/apply-on-boot.json');
    if (!existsSync(markerPath)) return;
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { updateId?: string };
      if (marker.updateId) {
        await this.prisma.updateRecord.update({
          where: { id: marker.updateId },
          data: { status: 'APPLIED', appliedAt: new Date() },
        });
        this.logger.log(`finalized applied update ${marker.updateId} on boot`);
      }
    } catch (err) {
      this.logger.error(`finalize-on-boot failed: ${(err as Error).message}`);
    } finally {
      await rm(markerPath, { force: true });
    }
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async currentVersion(): Promise<string> {
    try {
      const pkgRaw = await readFile(join(this.installRoot, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as { version?: string };
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async unzipTo(zipPath: string, destDir: string): Promise<void> {
    await new Promise<void>((resolveP, rejectP) => {
      const proc = spawn('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'ignore' });
      proc.on('error', rejectP);
      proc.on('exit', (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`unzip exited ${code}`));
      });
    });
    // The zip contains one top-level dir (your-restaurant-pos-v1.2.3/) —
    // flatten it into destDir. Detect by "single child that's a directory",
    // NOT by name pattern: version numbers have dots (v0.1.2), and a
    // dot-based heuristic incorrectly treats those as files and skips
    // the flatten step, breaking manifest.json lookup.
    const fsp = await import('node:fs/promises');
    const children = await fsp.readdir(destDir);
    if (children.length === 1) {
      const innerPath = join(destDir, children[0]!);
      const innerStat = await fsp.stat(innerPath);
      if (innerStat.isDirectory()) {
        const innerChildren = await fsp.readdir(innerPath);
        for (const c of innerChildren) {
          await rename(join(innerPath, c), join(destDir, c));
        }
        await rm(innerPath, { recursive: true, force: true });
      }
    }
    // Unused import shims to keep stream imports used by the type checker.
    void pipeline;
    void createReadStream;
    void createWriteStream;
    void (null as unknown as Readable);
  }
}

function generateId(): string {
  // Short URL-safe id — uses crypto for collision resistance. Not a
  // cuid() because the row id is ALSO the staging dir name; cuid's
  // 25 chars look bad in a path.
  return (
    Date.now().toString(36) +
    '-' +
    createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 8)
  );
}
