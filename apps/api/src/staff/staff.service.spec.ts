import { Test } from '@nestjs/testing';

import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StaffService } from './staff.service';

/** ID card fields (designation + photo) save on create and update. Local dev Postgres, disposable staff row. */
describe('StaffService ID card fields', () => {
  let prisma: PrismaService;
  let service: StaffService;
  let branchId: string;
  let staffId: string | null = null;
  const email = `test-idcard-${Date.now().toString(36)}@example.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [StaffService] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(StaffService);
    branchId = (await prisma.staff.findFirstOrThrow({ where: { role: 'OWNER', isActive: true } })).branchId;
  });

  afterAll(async () => {
    if (staffId) await prisma.staff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it('stores designation and photo on create, trimmed', async () => {
    const created = await service.create(branchId, {
      name: 'Test ID Card', email, password: 'password123', role: 'WAITER',
      designation: '  Senior Waiter  ', photoUrl: '/uploads/test.webp',
    });
    staffId = created.id;
    expect(created).toMatchObject({ designation: 'Senior Waiter', photoUrl: '/uploads/test.webp' });
  });

  it('updates and clears them, and lists them', async () => {
    const updated = await service.update(staffId!, branchId, { designation: 'Head Waiter' });
    expect(updated.designation).toBe('Head Waiter');
    expect(updated.photoUrl).toBe('/uploads/test.webp');
    const cleared = await service.update(staffId!, branchId, { designation: '   ', photoUrl: null });
    expect(cleared).toMatchObject({ designation: null, photoUrl: null });
    const row = (await service.findAll(branchId)).find((s) => s.id === staffId);
    expect(row).toMatchObject({ designation: null, photoUrl: null });
  });
});
