import { Test } from '@nestjs/testing';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';

/**
 * Regression test for GET /backup timing out (504, surfaced in the browser
 * as a CORS error): list() and the create responses used to include the
 * `data` column — the full gzipped database dump — for every record.
 */
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
