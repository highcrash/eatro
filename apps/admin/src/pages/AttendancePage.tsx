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
  const [tab, setTab] = useState<'daily' | 'summary'>('daily');
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const now = new Date();
  const [summaryYear, setSummaryYear] = useState(now.getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(now.getMonth() + 1);

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

  const markMutation = useMutation({
    mutationFn: (data: { staffId: string; status: AttendanceStatus }) =>
      api.post('/attendance', { staffId: data.staffId, date: selectedDate, status: data.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance', selectedDate] }),
  });

  const getStaffStatus = (staffId: string): AttendanceStatus | null => {
    const record = attendance.find((a) => a.staffId === staffId);
    return record?.status ?? null;
  };

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">ATTENDANCE</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#2A2A2A]">
        {(['daily', 'summary'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 font-body text-xs tracking-widest uppercase transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'
            }`}
          >
            {t === 'daily' ? 'Daily Attendance' : 'Monthly Summary'}
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
                  {['Staff', 'Role', 'Status', 'Mark Attendance'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const status = getStaffStatus(s.id);
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
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {staff.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-[#666] font-body text-sm">No active staff.</td></tr>
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
    </div>
  );
}
