import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipsoiClient, type TipsoiLog } from './tipsoi.client';

export interface TipsoiSyncResult {
  branchId: string;
  range: { from: string; to: string };
  scanned: number;
  created: number;
  updated: number;
  skippedByOverride: number;
  errors: string[];
}

interface ShiftSpec {
  /** Minutes since midnight (0..1439) — shift start. */
  startMinutes: number;
  /** Minutes since `startMinutes` until end. End may cross midnight,
   *  so we always represent it as a duration. */
  durationMinutes: number;
  /** Minutes after start before a clock-in is counted LATE. */
  graceMinutes: number;
  /** Minutes after start before a clock-in flips from LATE → HALF_DAY. */
  halfDayAfterMinutes: number;
}

/** Parse "HH:mm" to minutes since midnight, with 0..1439 clamp. */
function hmToMinutes(hm: string | null | undefined, fallback: number): number {
  if (!hm) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return hh * 60 + mm;
}

/** Compute duration between two HH:mm strings; if end ≤ start, the
 *  shift crosses midnight and we add 24h. */
function shiftDurationMinutes(start: string, end: string): number {
  const s = hmToMinutes(start, 600);
  const e = hmToMinutes(end, 1320);
  return e > s ? e - s : (24 * 60) - s + e;
}

/**
 * Tipsoi exchanges timestamps as bare "YYYY-MM-DD HH:mm:ss" strings
 * with no timezone marker — they're branch-local wall-clock times
 * (BD restaurants → Asia/Dhaka, +06:00). The previous helpers used
 * `getFullYear()` / `new Date(y, mo, d, h, mi, s)` which read/write
 * in the SERVER process's local TZ. DigitalOcean App Platform runs
 * in UTC, so every timestamp drifted by exactly the branch's offset
 * — sync windows missed recent logs and rows landed under the
 * wrong shiftDate. Now everything goes through the branch's
 * `Branch.timezone` column (default `Asia/Dhaka`).
 */

/** Compute the offset of the named timezone from UTC at instant `at`,
 *  in minutes (positive = ahead of UTC). Asia/Dhaka has no DST so
 *  this is +360 year-round; we still compute per-instant so future
 *  zones with DST behave correctly. */
function tzOffsetMinutes(tz: string, at: Date): number {
  // Round-trip the same instant through two ICU formatters and
  // diff them: the difference between "this instant rendered in tz"
  // and "this instant rendered in UTC" IS the offset.
  const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

/** Render `d` as branch-local "YYYY-MM-DD HH:mm:ss". Used both for
 *  outgoing query strings to Tipsoi /logs and for any log we display. */
function formatTipsoiTime(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // en-CA renders hour as "24" at midnight on some platforms; force "00".
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hh}:${get('minute')}:${get('second')}`;
}

/** Parse a Tipsoi "YYYY-MM-DD HH:mm:ss" wall-clock as a real Date
 *  instant. The literal numbers are interpreted in branch-local
 *  time; we back out the branch's UTC offset to land on the right
 *  global instant. */
function parseTipsoiTime(s: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return new Date(s); // best-effort
  // Treat the literal numbers as if they were UTC, then subtract the
  // branch's offset to get the actual instant.
  const asUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  const offsetMin = tzOffsetMinutes(tz, new Date(asUtc));
  return new Date(asUtc - offsetMin * 60_000);
}

/** Branch-local hour-of-day + date components for an instant. */
function branchLocalParts(d: Date, tz: string): { y: number; mo: number; day: number; h: number; mi: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), mo: get('month'), day: get('day'), h: get('hour') === 24 ? 0 : get('hour'), mi: get('minute') };
}

/** Date whose UTC year/month/day match the branch-local calendar date
 *  containing `d`. `Attendance.date` is a Postgres `DATE` column —
 *  Prisma serialises a JS Date to it using the UTC components, so
 *  feeding it the *instant* of branch-local midnight (e.g.
 *  2026-04-29T18:00Z for BD-midnight Apr 30) makes PG store "Apr 29",
 *  which is the bug we're fixing. By returning a Date at UTC midnight
 *  for the local Y/M/D, the stored DATE matches the admin's date
 *  picker label. */
function branchLocalDate(d: Date, tz: string): Date {
  const p = branchLocalParts(d, tz);
  return new Date(Date.UTC(p.y, p.mo - 1, p.day, 0, 0, 0));
}

/**
 * Resolve which Restora-side calendar date a given Tipsoi log belongs
 * to, given the staff's effective shiftStart. For an evening shift
 * (15:00 → 01:00), a 02:00 AM clock-out on Apr 29 belongs to Apr 28.
 *
 * Rule: walk back from the log's local time to the most recent
 * occurrence of `shiftStart` minus a 4-hour leeway (to catch staff
 * who arrive early). The calendar date of that anchor is the shift
 * date.
 */
function resolveShiftDate(loggedAt: Date, shiftStartMinutes: number, tz: string): Date {
  // Time-of-day in BRANCH-LOCAL time. Reading server-local
  // getHours()/getMinutes() (the previous bug) shifted overnight-
  // crossing logs into the wrong day on UTC servers.
  const local = branchLocalParts(loggedAt, tz);
  const t = local.h * 60 + local.mi;
  // Allow up to 4h before shiftStart to count as the same shift
  // (e.g. staff arrives at 11:00 for a 15:00 shift to set up).
  const windowStart = (shiftStartMinutes - 240 + 1440) % 1440;
  const sameDay = branchLocalDate(loggedAt, tz);
  const prevDay = new Date(sameDay.getTime() - 24 * 60 * 60 * 1000);
  if (shiftStartMinutes >= 12 * 60) {
    // afternoon/night shifts: any log earlier than `shiftStart - 4h`
    // belongs to the previous date.
    if (t < windowStart) return prevDay;
    return sameDay;
  }
  // morning/daytime shifts: just use the calendar date.
  return sameDay;
}

@Injectable()
export class TipsoiSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TipsoiClient,
  ) {}

  /**
   * Pull logs and reconcile Attendance for one branch over a date
   * range. The whole flow:
   *   1. Settings + token guard.
   *   2. Build personId → Staff lookup.
   *   3. Pull Tipsoi logs (over-fetch by 12h on each side for overnight shifts).
   *   4. Group logs by (staffId, shiftDate); take earliest = clockIn,
   *      latest = clockOut.
   *   5. Upsert Attendance rows; skip rows with manualOverride=true.
   *   6. Fill ABSENT for past dates with no logs.
   *   7. Stamp BranchSetting.tipsoiLastSyncAt + status.
   */
  async syncRange(branchId: string, fromDate: Date, toDate: Date): Promise<TipsoiSyncResult> {
    const errors: string[] = [];
    const result: TipsoiSyncResult = {
      branchId,
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      scanned: 0,
      created: 0,
      updated: 0,
      skippedByOverride: 0,
      errors,
    };

    const settings = await this.prisma.branchSetting.findUnique({ where: { branchId } });
    if (!settings) {
      errors.push('Branch settings not found');
      return result;
    }
    if (!settings.tipsoiEnabled || !settings.tipsoiApiToken) {
      errors.push('Tipsoi not enabled for this branch');
      return result;
    }

    // Branch timezone — used everywhere we touch wall-clock time. The
    // default mirrors the Prisma column default (`Asia/Dhaka`) so a
    // branch without an explicit timezone still behaves correctly.
    const branchRow = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    const tz = branchRow?.timezone || 'Asia/Dhaka';

    // Active staff with a Tipsoi person mapping.
    const staffList = await this.prisma.staff.findMany({
      where: { branchId, isActive: true, deletedAt: null, tipsoiPersonId: { not: null } },
    });
    if (staffList.length === 0) {
      // Don't error — sync just becomes a no-op. ABSENT-fill below
      // also short-circuits in this case.
      await this.stampSyncResult(branchId, 'OK (no staff mapped)');
      return result;
    }
    const byPersonId = new Map<string, typeof staffList[number]>();
    for (const s of staffList) {
      if (s.tipsoiPersonId) byPersonId.set(s.tipsoiPersonId, s);
    }

    // Pull logs. Over-fetch by 12h on each side to pick up overnight
    // shifts that span the window boundary. Window strings are
    // formatted in BRANCH-LOCAL time so Tipsoi (which uses local
    // wall-clock without a TZ marker) returns the right slice.
    const fetchStart = new Date(fromDate.getTime() - 12 * 60 * 60 * 1000);
    const fetchEnd = new Date(toDate.getTime() + 12 * 60 * 60 * 1000);
    let logs: TipsoiLog[];
    try {
      logs = await this.client.fetchLogs({
        apiUrl: settings.tipsoiApiUrl,
        apiToken: settings.tipsoiApiToken,
        start: formatTipsoiTime(fetchStart, tz),
        end: formatTipsoiTime(fetchEnd, tz),
      });
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      await this.stampSyncResult(branchId, `ERROR: ${msg.slice(0, 200)}`);
      return result;
    }
    result.scanned = logs.length;

    // Group logs by (staffId, shiftDate). Every wall-clock op flows
    // through `tz` so server UTC vs branch BD doesn't skew results.
    type Bucket = { staffId: string; shiftDate: Date; logs: { uid: string; loggedAt: Date }[]; spec: ShiftSpec };
    const buckets = new Map<string, Bucket>();
    for (const log of logs) {
      const staff = byPersonId.get(log.person_identifier);
      if (!staff) continue; // log for an unmapped person — skip silently
      const spec: ShiftSpec = this.specFor(staff, settings);
      const loggedAt = parseTipsoiTime(log.logged_time, tz);
      const shiftDate = resolveShiftDate(loggedAt, spec.startMinutes, tz);
      // Drop logs whose shift date falls outside the requested range.
      if (shiftDate < branchLocalDate(fromDate, tz) || shiftDate > branchLocalDate(toDate, tz)) continue;
      const key = `${staff.id}:${shiftDate.toISOString().slice(0, 10)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { staffId: staff.id, shiftDate, logs: [], spec };
        buckets.set(key, bucket);
      }
      bucket.logs.push({ uid: log.uid, loggedAt });
    }

    // Upsert Attendance per bucket.
    for (const bucket of buckets.values()) {
      try {
        // earliest = clockIn, latest = clockOut
        bucket.logs.sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
        const earliest = bucket.logs[0];
        const latest = bucket.logs[bucket.logs.length - 1];

        // Status from clockIn vs spec. Use BRANCH-LOCAL hour/minute,
        // not server-local — otherwise a 15:30 BD clock-in reads as
        // 09:30 on a UTC server and incorrectly looks "early" (or
        // worse: bins to the wrong day).
        const localClockIn = branchLocalParts(earliest.loggedAt, tz);
        const minutesAfterStart =
          (localClockIn.h * 60 + localClockIn.mi) - bucket.spec.startMinutes;
        // Normalise — overnight shift may produce a negative if staff
        // clocked in *just before* shiftStart (e.g. 14:55 for a 15:00
        // shift). Anything ≤ grace counts as PRESENT.
        const lateBy = Math.max(0, minutesAfterStart);
        let status: 'PRESENT' | 'LATE' | 'HALF_DAY';
        if (lateBy <= bucket.spec.graceMinutes) status = 'PRESENT';
        else if (lateBy <= bucket.spec.halfDayAfterMinutes) status = 'LATE';
        else status = 'HALF_DAY';

        // Skip if admin has overridden this row.
        const existing = await this.prisma.attendance.findUnique({
          where: { staffId_date: { staffId: bucket.staffId, date: bucket.shiftDate } },
        });
        if (existing && existing.manualOverride) {
          result.skippedByOverride += 1;
          continue;
        }
        if (!existing) {
          await this.prisma.attendance.create({
            data: {
              branchId,
              staffId: bucket.staffId,
              date: bucket.shiftDate,
              status,
              clockIn: earliest.loggedAt,
              clockOut: latest.loggedAt,
              source: 'TIPSOI',
              manualOverride: false,
              syncedClockIn: earliest.loggedAt,
              syncedClockOut: latest.loggedAt,
              syncedFromUid: earliest.uid,
            },
          });
          result.created += 1;
        } else {
          await this.prisma.attendance.update({
            where: { id: existing.id },
            data: {
              status,
              clockIn: earliest.loggedAt,
              clockOut: latest.loggedAt,
              source: 'TIPSOI',
              manualOverride: false,
              syncedClockIn: earliest.loggedAt,
              syncedClockOut: latest.loggedAt,
              syncedFromUid: earliest.uid,
            },
          });
          result.updated += 1;
        }
      } catch (e) {
        errors.push(`bucket ${bucket.staffId}@${bucket.shiftDate.toISOString().slice(0, 10)}: ${(e as Error).message}`);
      }
    }

    // ABSENT-fill: for every (staffId × shiftDate) in the range with
    // NO logs and NO existing row, AND the shiftDate is in the past,
    // create an ABSENT row. Today is left blank (admin sees a gap).
    try {
      await this.fillAbsentRows(branchId, staffList, fromDate, toDate, buckets, tz);
    } catch (e) {
      errors.push(`absent-fill: ${(e as Error).message}`);
    }

    await this.stampSyncResult(branchId, errors.length === 0 ? 'OK' : `OK (${errors.length} warnings)`);
    return result;
  }

  /** Resync a single (staff, date) — used by the "Restore from Tipsoi"
   *  button after admin clears manualOverride. The date param scopes
   *  the resync window; the staffId is implicit (only that staff's
   *  Tipsoi person_identifier maps to this row, so a full-branch
   *  syncRange catches it without per-staff filtering). */
  async syncOne(branchId: string, _staffId: string, date: Date): Promise<void> {
    const from = new Date(date.getTime() - 12 * 60 * 60 * 1000);
    const to = new Date(date.getTime() + 36 * 60 * 60 * 1000);
    await this.syncRange(branchId, from, to);
  }

  /** Resolve effective shift spec for a staff member, falling back to
   *  branch defaults for any null override. */
  private specFor(
    staff: { shiftStart: string | null; shiftEnd: string | null; lateGraceMinutes: number | null; halfDayAfterMinutes: number | null },
    settings: { attendanceShiftStart: string; attendanceShiftEnd: string; attendanceLateGraceMinutes: number; attendanceHalfDayAfterMinutes: number },
  ): ShiftSpec {
    const start = staff.shiftStart ?? settings.attendanceShiftStart;
    const end = staff.shiftEnd ?? settings.attendanceShiftEnd;
    return {
      startMinutes: hmToMinutes(start, hmToMinutes(settings.attendanceShiftStart, 600)),
      durationMinutes: shiftDurationMinutes(start, end),
      graceMinutes: staff.lateGraceMinutes ?? settings.attendanceLateGraceMinutes,
      halfDayAfterMinutes: staff.halfDayAfterMinutes ?? settings.attendanceHalfDayAfterMinutes,
    };
  }

  private async fillAbsentRows(
    branchId: string,
    staffList: { id: string }[],
    fromDate: Date,
    toDate: Date,
    bucketsByKey: Map<string, { staffId: string; shiftDate: Date }>,
    tz: string,
  ): Promise<void> {
    // "Today" means today in branch-local time. On a UTC server in
    // BD's late-night hours that's a different calendar date than
    // server-local — we'd otherwise either premature-ABSENT today's
    // shift or skip yesterday's shift.
    const today = branchLocalDate(new Date(), tz);
    const dates: Date[] = [];
    for (
      let d = branchLocalDate(fromDate, tz);
      d <= branchLocalDate(toDate, tz);
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    ) {
      // Only fill dates strictly in the past — today's not-yet-clocked
      // staff stay blank (admin sees a gap rather than a premature ABSENT).
      if (d.getTime() < today.getTime()) dates.push(new Date(d.getTime()));
    }
    if (dates.length === 0) return;

    // Pull all existing rows for the staff×date matrix in one shot to
    // avoid N×M findUniques.
    const existing = await this.prisma.attendance.findMany({
      where: {
        branchId,
        staffId: { in: staffList.map((s) => s.id) },
        date: { gte: dates[0], lte: dates[dates.length - 1] },
      },
      select: { staffId: true, date: true },
    });
    const existingKeys = new Set(existing.map((r) => `${r.staffId}:${r.date.toISOString().slice(0, 10)}`));

    for (const staff of staffList) {
      for (const d of dates) {
        const key = `${staff.id}:${d.toISOString().slice(0, 10)}`;
        if (existingKeys.has(key)) continue; // already has a row, skip
        if (bucketsByKey.has(key)) continue; // got logs this run, skip (already created above)
        await this.prisma.attendance.create({
          data: {
            branchId,
            staffId: staff.id,
            date: d,
            status: 'ABSENT',
            source: 'TIPSOI',
            manualOverride: false,
          },
        });
      }
    }
  }

  private async stampSyncResult(branchId: string, status: string): Promise<void> {
    await this.prisma.branchSetting
      .update({
        where: { branchId },
        data: { tipsoiLastSyncAt: new Date(), tipsoiLastSyncStatus: status },
      })
      .catch(() => { /* settings row already exists; ignore stamp errors */ });
  }
}
