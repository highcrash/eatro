import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { LeaveApplication, LeaveType, LeaveStatus } from '@restora/types';

interface StaffMember { id: string; name: string; role: string; isActive: boolean; }

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'SICK', label: 'Sick Leave' }, { value: 'CASUAL', label: 'Casual Leave' },
  { value: 'ANNUAL', label: 'Annual Leave' }, { value: 'UNPAID', label: 'Unpaid Leave' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: 'text-[#FFA726] bg-[#3a2e00]', APPROVED: 'text-[#4CAF50] bg-[#1a3a1a]', REJECTED: 'text-[#D62B2B] bg-[#3a1a1a]',
};

export default function LeavePage() {
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ staffId: '', type: 'CASUAL' as LeaveType, startDate: '', endDate: '', reason: '' });

  const { data: leaves = [], isLoading } = useQuery<LeaveApplication[]>({ queryKey: ['leaves'], queryFn: () => api.get('/leave') });
  const { data: staff = [] } = useQuery<StaffMember[]>({ queryKey: ['staff'], queryFn: () => api.get('/staff'), select: (d) => d.filter((s: StaffMember) => s.isActive) });

  const createMut = useMutation({ mutationFn: () => api.post('/leave', form), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['leaves'] }); setShowDialog(false); } });
  const approveMut = useMutation({ mutationFn: (id: string) => api.post(`/leave/${id}/approve`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['leaves'] }) });
  const rejectMut = useMutation({ mutationFn: (id: string) => api.post(`/leave/${id}/reject`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['leaves'] }) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">LEAVE APPLICATIONS</h1>
        <button onClick={() => setShowDialog(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">+ APPLY LEAVE</button>
      </div>
      {isLoading ? <p className="text-[#666] font-body text-sm">Loading...</p> : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead><tr className="border-b border-[#2A2A2A]">
              {['Staff', 'Type', 'From', 'To', 'Reason', 'Status', 'Actions'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-white font-body text-sm">{l.staff?.name}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">{l.type}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(l.startDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(l.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[#666] font-body text-xs">{l.reason ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                  <td className="px-4 py-3 flex gap-2">
                    {l.status === 'PENDING' && <>
                      <button onClick={() => approveMut.mutate(l.id)} className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Approve</button>
                      <button onClick={() => rejectMut.mutate(l.id)} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">Reject</button>
                    </>}
                  </td>
                </tr>
              ))}
              {leaves.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No leave applications.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {showDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">APPLY FOR LEAVE</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Staff *</label><select value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"><option value="">— Select —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}</select></div>
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Type</label><select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LeaveType }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">{LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Start Date *</label><input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
                <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">End Date *</label><input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
              </div>
              <div className="flex flex-col gap-1"><label className="text-[#666] text-xs font-body tracking-widest uppercase">Reason</label><input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" /></div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowDialog(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => createMut.mutate()} disabled={!form.staffId || !form.startDate || !form.endDate || createMut.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">{createMut.isPending ? 'Submitting...' : 'Submit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
