import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { gunzipSync } from 'zlib';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { BACKUP_FILE_VERSION, BACKUP_MODELS } from './backup.constants';
import { BackupService } from './backup.service';

/**
 * Regression tests for the backup feature on a 512 MB instance:
 * - GET /backup timed out because list() and create responses included the
 *   `data` column (the full gzipped dump) for every record.
 * - createBackup ran out of memory because it loaded every table at once;
 *   it now streams, and only one backup may run at a time.
 */
jest.setTimeout(120_000); // each backup dumps the whole local dev database

describe('BackupService — responses never carry the dump payload', () => {
  let svc: BackupService;
  let prisma: PrismaService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    delete process.env.SPACES_BUCKET;
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [BackupService],
    }).compile();
    svc = moduleRef.get(BackupService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    for (const id of createdIds) await svc.deleteBackup(id).catch(() => undefined);
  });

  it('createBackup returns metadata only, while the dump is still stored', async () => {
    const rec = await svc.createBackup('MANUAL');
    createdIds.push(rec.id);
    expect(rec).not.toHaveProperty('data');
    expect(rec.sizeBytes).toBeGreaterThan(0);

    const stored = await prisma.backupRecord.findUniqueOrThrow({ where: { id: rec.id }, select: { data: true } });
    expect(stored.data?.length).toBe(rec.sizeBytes);
  });

  it('list() returns metadata only, and its JSON stays small', async () => {
    const rec = await svc.createBackup('MANUAL');
    createdIds.push(rec.id);

    const rows = await svc.list();
    const mine = rows.find((r) => r.id === rec.id);
    expect(mine).toBeDefined();
    expect(rows.every((r) => !('data' in r))).toBe(true);
    // ~200 bytes of metadata per row, regardless of how big each dump is.
    expect(JSON.stringify(rows).length).toBeLessThan(rows.length * 600);
  });

  it('refuses a second backup while one is running', async () => {
    const first = svc.createBackup('MANUAL');
    await expect(svc.createBackup('MANUAL')).rejects.toThrow(ConflictException);
    createdIds.push((await first).id);
  });

  it('writes the original file shape with every table and the right row counts', async () => {
    const rec = await svc.createBackup('MANUAL');
    createdIds.push(rec.id);
    const stored = await prisma.backupRecord.findUniqueOrThrow({ where: { id: rec.id }, select: { data: true } });
    const parsed = JSON.parse(gunzipSync(stored.data!).toString('utf8'));

    expect(Object.keys(parsed)).toEqual(['version', 'createdAt', 'type', 'data']);
    expect(parsed).toMatchObject({ version: BACKUP_FILE_VERSION, type: 'MANUAL' });
    expect(Object.keys(parsed.data)).toEqual(BACKUP_MODELS.map((m) => m.accessor));
    // Tables no other spec writes to — specs run in parallel.
    for (const accessor of ['branch', 'staff', 'customer', 'diningTable', 'unitConversion']) {
      const count = await (prisma as any)[accessor].count();
      expect({ accessor, rows: parsed.data[accessor].length }).toEqual({ accessor, rows: count });
    }
  });

  it('download still streams the stored dump', async () => {
    const { sizeBytes } = await svc.getDownloadStream(createdIds[0]);
    expect(sizeBytes).toBeGreaterThan(0);
  });

  it('deleteBackup removes the record', async () => {
    const id = createdIds.pop()!;
    await svc.deleteBackup(id);
    expect(await prisma.backupRecord.findUnique({ where: { id }, select: { id: true } })).toBeNull();
  });
});
