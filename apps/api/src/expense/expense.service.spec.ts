import { Test } from '@nestjs/testing';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExpenseService } from './expense.service';

/**
 * The Expenses page asks for a whole month; a busy month has more than
 * 200 entries and the list used to stop at the latest 200 (mid-month).
 * Runs against the local dev Postgres with disposable rows.
 */
describe('ExpenseService.findAll date range', () => {
  let prisma: PrismaService;
  let service: ExpenseService;
  let branchId: string;
  const tag = `Test expense range ${Date.now().toString(36)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    // Account / payroll side effects aren't touched by findAll.
    service = new ExpenseService(prisma, {} as never, {} as never);
    const owner = await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } });
    branchId = owner.branchId;
    // 250 expenses spread over a far-past month, 1st..31st.
    await prisma.expense.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        branchId,
        description: tag,
        amount: 100,
        date: new Date(Date.UTC(1999, 9, 1 + (i % 31))),
        recordedById: owner.id,
      })),
    });
  });

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { description: tag } });
    await prisma.$disconnect();
  });

  it('returns every expense in the range, first day to last day', async () => {
    const rows = (await service.findAll(branchId, { from: '1999-10-01', to: '1999-10-31' })).filter((e) => e.description === tag);
    expect(rows).toHaveLength(250);
    const days = rows.map((e) => e.date.toISOString().slice(0, 10));
    expect(days).toContain('1999-10-01');
    expect(days).toContain('1999-10-31');
  });

  it('agrees with the summary total for the same range', async () => {
    const rows = (await service.findAll(branchId, { from: '1999-10-01', to: '1999-10-31' })).filter((e) => e.description === tag);
    const summary = await service.getSummary(branchId, '1999-10-01', '1999-10-31');
    expect(summary.count).toBeGreaterThanOrEqual(rows.length);
  });

  it('still caps the open-ended list', async () => {
    expect((await service.findAll(branchId)).length).toBeLessThanOrEqual(200);
  });
});
