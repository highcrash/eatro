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

/** Format a Date in branch-local-time as "YYYY-MM-DD HH:mm:ss" for
 *  the Tipsoi /logs query string. We don't have a TZ database in
 *  scope; treat server clock as branch local (matches how the rest
 *  of the project stores attendance dates as @db.Date without TZ).
 */
function formatTipsoiTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** "YYYY-MM-DD HH:mm:ss" → Date. Tipsoi has no TZ on the wire; we
 *  parse as local-time, matching the project convention. */
function parseTipsoiTime(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return new Date(s); // best-effort
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

/** Truncate a Date to 00:00 local-time of the same calendar day. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
function resolveShiftDate(loggedAt: Date, shiftStartMinutes: number): Date {
  const t = loggedAt.getHours() * 60 + loggedAt.getMinutes();
  // Allow up to 4h before shiftStart to count as the same shift
  // (e.g. staff arrives at 11:00 for a 15:00 shift to set up).
  const windowStart = (shiftStartMinutes - 240 + 1440) % 1440;
  // If shiftStart > windowStart (no wrap), today's window is
  // [windowStart..shiftStart..shiftStart+duration]. Otherwise we're
  // crossing midnight in the leeway; treat the previous calendar day
  // as the anchor when t is in the early-morning leeway slice.
  const sameDay = startOfDay(loggedAt);
  const prevDay = new Date(sameDay.getTime() - 24 * 60 * 60 * 1000);
  // Heuristic: if the log time-of-day is before the shift's
  // windowStart (and the shift is an evening/night shift), bin to
  // the previous calendar date.
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
    // shifts that span the window boundary.
    const fetchStart = new Date(fromDate.getTime() - 12 * 60 * 60 * 1000);
    const fetchEnd = new Date(toDate.getTime() + 12 * 60 * 60 * 1000);
    let logs: TipsoiLog[];
    try {
      logs = await this.client.fetchLogs({
        apiUrl: settings.tipsoiApiUrl,
        apiToken: settings.tipsoiApiToken,
        start: formatTipsoiTime(fetchStart),
        end: formatTipsoiTime(fetchEnd),
      });
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      await this.stampSyncResult(branchId, `ERROR: ${msg.slice(0, 200)}`);
      return result;
    }
    result.scanned = logs.length;

    // Group logs by (staffId, shiftDate).
    type Bucket = { staffId: string; shiftDate: Date; logs: { uid: string; loggedAt: Date }[]; spec: ShiftSpec };
    const buckets = new Map<string, Bucket>();
    for (const log of logs) {
      const staff = byPersonId.get(log.person_identifier);
      if (!staff) continue; // log for an unmapped person — skip silently
      const spec: ShiftSpec = this.specFor(staff, settings);
      const loggedAt = parseTipsoiTime(log.logged_time);
      const shiftDate = resolveShiftDate(loggedAt, spec.startMinutes);
      // Drop logs whose shift date falls outside the requested range.
      if (shiftDate < startOfDay(fromDate) || shiftDate > startOfDay(toDate)) continue;
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

        // Status from clockIn vs spec.
        const minutesAfterStart =
          (earliest.loggedAt.getHours() * 60 + earliest.loggedAt.getMinutes()) -
          bucket.spec.startMinutes;
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
      await this.fillAbsentRows(branchId, staffList, fromDate, toDate, buckets);
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
  ): Promise<void> {
    const today = startOfDay(new Date());
    const dates: Date[] = [];
    for (
      let d = startOfDay(fromDate);
      d <= startOfDay(toDate);
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
