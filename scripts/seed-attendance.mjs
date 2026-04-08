/**
 * Seed mock attendance data for all staff for Feb & Mar 2026.
 * Run: node scripts/seed-attendance.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const staff = await prisma.staff.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, branchId: true, role: true },
  });

  // Skip OWNER — they don't clock in
  const clockableStaff = staff.filter((s) => s.role !== 'OWNER');
  const branchId = staff[0].branchId;

  const statuses = ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'LATE', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'SICK_LEAVE'];
  // Friday is weekend in BD restaurants — use FESTIVAL_LEAVE or ABSENT
  const fridayStatuses = ['FESTIVAL_LEAVE', 'FESTIVAL_LEAVE', 'PRESENT', 'HALF_DAY'];

  const startDate = new Date('2026-02-01');
  const endDate = new Date('2026-03-31');

  const batch = [];
  let count = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay(); // 0=Sun, 5=Fri
    const isFriday = dayOfWeek === 5;
    const dateStr = d.toISOString().split('T')[0];

    for (const s of clockableStaff) {
      const status = isFriday ? randomChoice(fridayStatuses) : randomChoice(statuses);

      let clockIn = null;
      let clockOut = null;

      if (status === 'PRESENT' || status === 'LATE' || status === 'HALF_DAY') {
        const baseHour = status === 'LATE' ? randomInt(10, 12) : randomInt(8, 9);
        const baseMin = randomInt(0, 59);
        clockIn = new Date(d);
        clockIn.setHours(baseHour, baseMin, 0, 0);

        if (status === 'HALF_DAY') {
          clockOut = new Date(d);
          clockOut.setHours(baseHour + randomInt(3, 4), randomInt(0, 59), 0, 0);
        } else {
          clockOut = new Date(d);
          clockOut.setHours(baseHour + randomInt(8, 10), randomInt(0, 59), 0, 0);
        }
      }

      let notes = null;
      if (status === 'SICK_LEAVE') notes = 'Called in sick';
      if (status === 'PAID_LEAVE') notes = 'Approved leave';
      if (status === 'LATE' && clockIn) notes = `Arrived at ${clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

      batch.push({
        branchId,
        staffId: s.id,
        date: new Date(dateStr),
        clockIn,
        clockOut,
        status,
        notes,
      });
      count++;
    }
  }

  // Insert in chunks to avoid conflicts
  const chunkSize = 100;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    await prisma.attendance.createMany({ data: chunk, skipDuplicates: true });
    console.log(`  Inserted ${Math.min(i + chunkSize, batch.length)} / ${batch.length}`);
  }

  // Print summary
  const summary = {};
  for (const r of batch) {
    const staffName = clockableStaff.find((s) => s.id === r.staffId)?.name || r.staffId;
    if (!summary[staffName]) summary[staffName] = {};
    summary[staffName][r.status] = (summary[staffName][r.status] || 0) + 1;
  }

  console.log('\n✅ Seeded attendance for Feb-Mar 2026');
  console.log(`   ${count} records for ${clockableStaff.length} staff\n`);
  console.log('Summary:');
  for (const [name, counts] of Object.entries(summary)) {
    const parts = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  ${name}: ${parts}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
