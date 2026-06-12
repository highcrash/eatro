import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Attendance, AttendanceStatus } from '@restora/types';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface MonthSummary {
  staffId: string;
  name: string;
  role: string;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; color: string; short: string }[] = [
  { value: 'PRESENT', label: 'Present', color: 'text-[#4CAF50]', short: 'P' },
  { value: 'LATE', label: 'Late', color: 'text-[#FFA726]', short: 'L' },
  { value: 'HALF_DAY', label: 'Half Day', color: 'text-[#29B6F6]', short: 'H' },
  { value: 'ABSENT', label: 'Absent', color: 'text-[#D62B2B]', short: 'A' },
  { value: 'PAID_LEAVE', label: 'Paid Leave', color: 'text-[#CE93D8]', short: 'PL' },
  { value: 'SICK_LEAVE', label: 'Sick Leave', color: 'text-[#AB47BC]', short: 'SL' },
  { value: 'FESTIVAL_LEAVE', label: 'Festival', color: 'text-[#66BB6A]', short: 'FL' },
];

export default function AttendancePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'daily' | 'summary' | 'sheet'>('daily');
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const now = new Date();
  const [summaryYear, setSummaryYear] = useState(now.getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(now.getMonth() + 1);

  // Print Sheet tab state — picks ONE staff for a specific month so
  // admin can print a per-staff timesheet with daily clock-in /
  // clock-out / hours. Defaults to the current month and the first
  // active staff member as soon as the staff list loads.
  const [sheetStaffId, setSheetStaffId] = useState<string>('');
  const [sheetYear, setSheetYear] = useState(now.getFullYear());
  const [sheetMonth, setSheetMonth] = useState(now.getMonth() + 1);

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff-active'],
    queryFn: () => api.get('/staff'),
    select: (d) => d.filter((s: StaffMember) => s.isActive),
  });

  const { data: attendance = [] } = useQuery<Attendance[]>({
    queryKey: ['attendance', selectedDate],
    queryFn: () => api.get(`/attendance?date=${selectedDate}`),
  });

  const { data: summary = [] } = useQuery<MonthSummary[]>({
    queryKey: ['attendance-summary', summaryYear, summaryMonth],
    queryFn: () => api.get(`/attendance/summary?year=${summaryYear}&month=${summaryMonth}`),
    enabled: tab === 'summary',
  });

  // Sheet data: one staff × one calendar month. Server returns rows
  // in chronological order when the from/to range is supplied.
  const sheetFrom = `${sheetYear}-${String(sheetMonth).padStart(2, '0')}-01`;
  // Last day of the picked month — `new Date(y, m, 0)` with 1-based m
  // returns the previous month's last day, which is what we want.
  const sheetTo = new Date(sheetYear, sheetMonth, 0).toISOString().slice(0, 10);
  const { data: sheetRows = [] } = useQuery<Attendance[]>({
    queryKey: ['attendance-sheet', sheetStaffId, sheetFrom, sheetTo],
    queryFn: () => api.get(`/attendance?staffId=${sheetStaffId}&from=${sheetFrom}&to=${sheetTo}`),
    enabled: tab === 'sheet' && !!sheetStaffId,
  });

  const markMutation = useMutation({
    mutationFn: (data: { staffId: string; status: AttendanceStatus }) =>
      api.post('/attendance', { staffId: data.staffId, date: selectedDate, status: data.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance', selectedDate] }),
  });

  /** Drop the manual override on a row and let Tipsoi repopulate it.
   *  Surfaced as the "↻ Restore" button on rows where admin has
   *  hand-marked the status. */
  const clearOverrideMutation = useMutation({
    mutationFn: (staffId: string) =>
      api.post('/attendance/clear-override', { staffId, date: selectedDate }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance', selectedDate] }),
  });

  const getStaffRow = (staffId: string): Attendance | null => {
    const record = attendance.find((a) => a.staffId === staffId);
    return (record as Attendance | undefined) ?? null;
  };

  /** Format a clock event as h:mm AM/PM for the cell. */
  const fmtTime = (iso: string | Date | null): string => {
    if (!iso) return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  /** Hours between clockIn and clockOut, formatted "8h 35m". Handles
   *  overnight shifts (clockOut < clockIn) by adding 24h. Returns
   *  empty string when either side is missing. */
  const hoursBetween = (inIso: string | Date | null, outIso: string | Date | null): string => {
    if (!inIso || !outIso) return '';
    const a = new Date(inIso).getTime();
    const b = new Date(outIso).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return '';
    let ms = b - a;
    if (ms < 0) ms += 24 * 3600 * 1000; // overnight wrap
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  };

  /** Decimal hours used for the running monthly total. */
  const decimalHours = (inIso: string | Date | null, outIso: string | Date | null): number => {
    if (!inIso || !outIso) return 0;
    const a = new Date(inIso).getTime();
    const b = new Date(outIso).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    let ms = b - a;
    if (ms < 0) ms += 24 * 3600 * 1000;
    return ms / 3600000;
  };

  // Default the print-sheet staff to the first active staff member
  // as soon as that list arrives — saves admin a click.
  if (!sheetStaffId && staff.length > 0) {
    // Setting state inside render is allowed for first-paint defaults
    // when guarded by a condition that becomes false after the set.
    setSheetStaffId(staff[0].id);
  }

  const sheetStaff = staff.find((s) => s.id === sheetStaffId);
  // Build a Date → row index so we can render one row per calendar
  // day even when the DB has no attendance entry for that day
  // (weekly off, future days). Sorted ascending by the server.
  const sheetByDate = new Map<string, Attendance>(
    sheetRows.map((r) => [String(r.date).slice(0, 10), r] as const),
  );
  const daysInMonth = new Date(sheetYear, sheetMonth, 0).getDate();
  const sheetDays = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const iso = `${sheetYear}-${String(sheetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { iso, day, row: sheetByDate.get(iso) ?? null };
  });
  const sheetTotalHours = sheetDays.reduce(
    (sum, d) => sum + decimalHours(d.row?.clockIn ?? null, d.row?.clockOut ?? null),
    0,
  );
  const sheetPresentCount = sheetDays.filter((d) => d.row && d.row.status !== 'ABSENT').length;
  const sheetMonthLabel = `${MONTHS[sheetMonth - 1]} ${sheetYear}`;

  return (
    <div className="space-y-6 attendance-page">
      {/* Print styles — same isolation trick used by ReportsPage /
          StockWatcher. Hides admin chrome + the tabs + form controls
          so only the printable attendance sheet survives Ctrl+P. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .attendance-page, .attendance-page * {
            visibility: visible !important;
          }
          .attendance-page {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-family: Arial, sans-serif !important;
          }
          .attendance-page * {
            color: #000 !important;
            background: transparent !important;
            border-color: #999 !important;
          }
          .no-print { display: none !important; }
          .attendance-page table th, .attendance-page table td {
            border: 1px solid #ccc !important;
            padding: 4px 8px !important;
          }
        }
      `}</style>

      <div className="flex items-center justify-between no-print">
        <h1 className="font-display text-3xl text-white tracking-widest">ATTENDANCE</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#2A2A2A] no-print">
        {(['daily', 'summary', 'sheet'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 font-body text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'
            }`}
          >
            {t === 'daily' ? 'Daily Attendance' : t === 'summary' ? 'Monthly Summary' : 'Print Sheet'}
          </button>
        ))}
      </div>

      {/* Daily Tab */}
      {tab === 'daily' && (
        <>
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              />
            </div>
            <p className="text-[#666] font-body text-sm mt-5">{attendance.length} records for this date</p>
          </div>

          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Staff', 'Role', 'Status', 'Clock In', 'Source', 'Mark Attendance'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const row = getStaffRow(s.id);
                  const status = row?.status ?? null;
                  return (
                    <tr key={s.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                      <td className="px-4 py-3 text-white font-body text-sm">{s.name}</td>
                      <td className="px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{s.role}</td>
                      <td className="px-4 py-3">
                        {status ? (
                          <span className={`font-body text-xs tracking-widest uppercase ${STATUS_OPTIONS.find((o) => o.value === status)?.color ?? 'text-[#999]'}`}>
                            {STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
                          </span>
                        ) : (
                          <span className="text-[#2A2A2A] font-body text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#999] font-body text-xs">
                        {row?.clockIn ? fmtTime(row.clockIn as unknown as Date) : <span className="text-[#2A2A2A]">—</span>}
                        {row?.clockOut && (
                          <span className="text-[#666] ml-2">→ {fmtTime(row.clockOut as unknown as Date)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row?.manualOverride ? (
                          <span title="Admin hand-set this row — Tipsoi sync skips it. Click ↻ to restore."
                            className="font-body text-[10px] tracking-widest uppercase px-2 py-0.5 bg-[#D62B2B]/20 text-[#F03535]">
                            Override
                          </span>
                        ) : row?.source === 'TIPSOI' ? (
                          <span title="Imported from Tipsoi"
                            className="font-body text-[10px] tracking-widest uppercase px-2 py-0.5 bg-[#FFA726]/20 text-[#FFA726]">
                            Tipsoi
                          </span>
                        ) : row ? (
                          <span title="Marked manually" className="font-body text-[10px] tracking-widest uppercase px-2 py-0.5 bg-[#2A2A2A] text-[#999]">
                            Manual
                          </span>
                        ) : (
                          <span className="text-[#2A2A2A] font-body text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap items-center">
                          {STATUS_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => markMutation.mutate({ staffId: s.id, status: opt.value })}
                              disabled={markMutation.isPending}
                              title={opt.label}
                              className={`px-2 py-1 font-body text-[10px] tracking-widest uppercase transition-colors ${
                                status === opt.value
                                  ? 'bg-[#D62B2B] text-white'
                                  : 'bg-[#2A2A2A] text-[#666] hover:text-white hover:bg-[#1F1F1F]'
                              }`}
                            >
                              {opt.short}
                            </button>
                          ))}
                          {row?.manualOverride && (
                            <button
                              onClick={() => clearOverrideMutation.mutate(s.id)}
                              disabled={clearOverrideMutation.isPending}
                              title="Drop the manual override and re-pull this row from Tipsoi"
                              className="px-2 py-1 font-body text-[10px] tracking-widest uppercase bg-[#FFA726]/20 text-[#FFA726] hover:bg-[#FFA726]/30 transition-colors"
                            >
                              ↻ Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {staff.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#666] font-body text-sm">No active staff.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <>
          <div className="flex gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Month</label>
              <select
                value={summaryMonth}
                onChange={(e) => setSummaryMonth(parseInt(e.target.value))}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              >
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Year</label>
              <input
                type="number" min="2020" max="2099"
                value={summaryYear}
                onChange={(e) => setSummaryYear(parseInt(e.target.value))}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors w-24"
              />
            </div>
          </div>

          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Staff', 'Role', 'Present', 'Late', 'Half Day', 'Absent', 'PL', 'SL', 'FL', 'Total'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.staffId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-white font-body text-sm">{s.name}</td>
                    <td className="px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{s.role}</td>
                    <td className="px-4 py-3 text-[#4CAF50] font-body font-medium text-sm">{s.present}</td>
                    <td className="px-4 py-3 text-[#FFA726] font-body text-sm">{s.late}</td>
                    <td className="px-4 py-3 text-[#29B6F6] font-body text-sm">{s.halfDay}</td>
                    <td className="px-4 py-3 text-[#D62B2B] font-body text-sm">{s.absent}</td>
                    <td className="px-4 py-3 text-[#CE93D8] font-body text-xs">{(s as any).paidLeave || 0}</td>
                    <td className="px-4 py-3 text-[#AB47BC] font-body text-xs">{(s as any).sickLeave || 0}</td>
                    <td className="px-4 py-3 text-[#66BB6A] font-body text-xs">{(s as any).festivalLeave || 0}</td>
                    <td className="px-4 py-3 text-white font-body text-sm">{s.present + s.late + s.halfDay + s.absent + ((s as any).paidLeave || 0) + ((s as any).sickLeave || 0) + ((s as any).festivalLeave || 0)}</td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-[#666] font-body text-sm">No attendance records for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Print Sheet Tab — per-staff monthly timesheet.
          Admin picks a staff + month → printable table with one row
          per calendar day showing clock-in / clock-out / hours /
          status / notes. The print stylesheet at the top of this
          page hides the form controls + page chrome so Ctrl+P (or
          Save as PDF) produces a clean A4 hardcopy. */}
      {tab === 'sheet' && (
        <>
          <div className="flex flex-wrap items-end gap-4 no-print">
            <div className="flex flex-col gap-1 min-w-[220px]">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Staff</label>
              <select
                value={sheetStaffId}
                onChange={(e) => setSheetStaffId(e.target.value)}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.role}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Month</label>
              <select
                value={sheetMonth}
                onChange={(e) => setSheetMonth(parseInt(e.target.value))}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              >
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Year</label>
              <input
                type="number" min="2020" max="2099"
                value={sheetYear}
                onChange={(e) => setSheetYear(parseInt(e.target.value))}
                className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors w-24"
              />
            </div>
            <button
              onClick={() => window.print()}
              disabled={!sheetStaffId}
              title="Print or save as PDF (Ctrl+P / ⌘+P also works)"
              className="px-4 py-2 bg-[#2A2A2A] hover:bg-[#D62B2B] text-white text-xs tracking-widest uppercase transition-colors disabled:opacity-40"
            >
              🖨 Print / PDF
            </button>
          </div>

          {/* Printable header — visible on screen too so the page
              looks coherent. The print stylesheet collapses the rest
              of the admin chrome, so this header anchors the
              hardcopy. */}
          {sheetStaff && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-4">
              <div className="flex items-end justify-between flex-wrap gap-2">
                <div>
                  <p className="text-[#D62B2B] text-[10px] tracking-widest uppercase">Attendance Sheet</p>
                  <p className="font-display text-2xl text-white tracking-wide">{sheetStaff.name}</p>
                  <p className="text-xs text-[#999]">{sheetStaff.role} · {sheetMonthLabel}</p>
                </div>
                <div className="text-right text-xs text-[#ccc] font-body">
                  <p>
                    <span className="text-[#666]">Days marked:</span> <span className="text-white font-bold">{sheetPresentCount}</span> / {daysInMonth}
                  </p>
                  <p>
                    <span className="text-[#666]">Total hours:</span> <span className="text-[#4CAF50] font-bold">{sheetTotalHours.toFixed(1)} h</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Date', 'Day', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Source', 'Notes'].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetDays.map(({ iso, day, row }) => {
                  const d = new Date(iso);
                  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
                  const status = row?.status ?? null;
                  return (
                    <tr key={iso} className="border-b border-[#2A2A2A] last:border-0">
                      <td className="px-4 py-2 text-white font-body text-xs">{String(day).padStart(2, '0')}</td>
                      <td className="px-4 py-2 text-[#999] font-body text-xs">{weekday}</td>
                      <td className="px-4 py-2 text-[#ccc] font-body text-xs">
                        {row?.clockIn ? fmtTime(row.clockIn as unknown as Date) : <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-2 text-[#ccc] font-body text-xs">
                        {row?.clockOut ? fmtTime(row.clockOut as unknown as Date) : <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-2 text-white font-body text-xs font-medium">
                        {hoursBetween(row?.clockIn ?? null, row?.clockOut ?? null) || <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {status ? (
                          <span className={`font-body text-[10px] tracking-widest uppercase ${STATUS_OPTIONS.find((o) => o.value === status)?.color ?? 'text-[#999]'}`}>
                            {STATUS_OPTIONS.find((o) => o.value === status)?.short ?? status}
                          </span>
                        ) : <span className="text-[#444] text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2 text-[#666] font-body text-[10px] tracking-widest uppercase">
                        {row?.manualOverride ? 'Override' : row?.source === 'TIPSOI' ? 'Tipsoi' : row ? 'Manual' : '—'}
                      </td>
                      <td className="px-4 py-2 text-[#999] font-body text-xs">{row?.notes ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#2A2A2A] bg-[#0D0D0D]">
                  <td colSpan={4} className="px-4 py-2 text-right text-[#666] font-body text-xs tracking-widest uppercase">Month total</td>
                  <td className="px-4 py-2 text-[#4CAF50] font-body text-xs font-bold">{sheetTotalHours.toFixed(1)} h</td>
                  <td colSpan={3} className="px-4 py-2 text-[#666] font-body text-xs">
                    Days marked: {sheetPresentCount} / {daysInMonth}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
