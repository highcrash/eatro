import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Camera } from 'lucide-react';

import { api } from '../lib/api';
import { resizeImage } from '../lib/image-resize';

interface Staff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  customRoleId?: string | null;
  isActive: boolean;
  canAccessPos: boolean;
  canHandleChats?: boolean;
  hireDate: string;
  // Tipsoi attendance fields. Optional everywhere — empty means "use
  // branch defaults" for shift / grace / half-day cutoff.
  tipsoiPersonId?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  lateGraceMinutes?: number | null;
  halfDayAfterMinutes?: number | null;
  // Salary + leave assignment. Null means "no structure / rule" —
  // payroll falls back to monthlySalary + hardcoded thresholds, leave
  // approval skips balance tracking.
  salaryStructureId?: string | null;
  leaveRuleId?: string | null;
  // ID card: job title (separate from the access `role`) and photo.
  designation?: string | null;
  photoUrl?: string | null;
}

interface CustomRoleLite {
  id: string;
  name: string;
  baseRole: string;
  description?: string | null;
}

interface SalaryStructureLite {
  id: string;
  name: string;
}

interface LeaveRuleLite {
  id: string;
  name: string;
}

const ROLES = ['OWNER', 'MANAGER', 'ADVISOR', 'CASHIER', 'KITCHEN', 'WAITER'] as const;

function StaffDialog({ initial, onClose }: { initial?: Staff; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    role: initial?.role ?? 'CASHIER',
    customRoleId: initial?.customRoleId ?? '',
    password: '',
    isActive: initial?.isActive ?? true,
    canAccessPos: initial?.canAccessPos ?? true,
    canHandleChats: initial?.canHandleChats ?? false,
    // Attendance / Tipsoi fields
    tipsoiPersonId: initial?.tipsoiPersonId ?? '',
    shiftStart: initial?.shiftStart ?? '',
    shiftEnd: initial?.shiftEnd ?? '',
    lateGraceMinutes: initial?.lateGraceMinutes != null ? String(initial.lateGraceMinutes) : '',
    halfDayAfterMinutes: initial?.halfDayAfterMinutes != null ? String(initial.halfDayAfterMinutes) : '',
    // Salary structure + leave rule assignment.
    salaryStructureId: initial?.salaryStructureId ?? '',
    leaveRuleId: initial?.leaveRuleId ?? '',
    // ID card
    designation: initial?.designation ?? '',
    photoUrl: initial?.photoUrl ?? '',
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // "Use custom shift" toggle — collapsed by default. Auto-expands when
  // ANY shift override field is already set on the existing staff row.
  const [showShift, setShowShift] = useState(
    !!(initial?.shiftStart || initial?.shiftEnd ||
       initial?.lateGraceMinutes != null || initial?.halfDayAfterMinutes != null),
  );
  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    setUploadError(null);
    try {
      const resized = await resizeImage(file, 'staffPhoto');
      const result = await api.upload<{ url: string }>('/upload/image', resized);
      set('photoUrl', result.url);
    } catch (err) {
      setUploadError((err as Error).message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Custom roles the admin may assign. Filter to ones whose baseRole
  // matches the selected role — a "Head Chef" (base=KITCHEN) shouldn't
  // be assignable to a staff currently on role=CASHIER.
  const { data: customRoles = [] } = useQuery<CustomRoleLite[]>({
    queryKey: ['custom-roles'],
    queryFn: () => api.get<CustomRoleLite[]>('/custom-roles'),
  });
  const filteredCustomRoles = customRoles.filter((c) => c.baseRole === form.role);

  const { data: salaryStructures = [] } = useQuery<SalaryStructureLite[]>({
    queryKey: ['salary-structures'],
    queryFn: () => api.get<SalaryStructureLite[]>('/salary-structures'),
  });
  const { data: leaveRules = [] } = useQuery<LeaveRuleLite[]>({
    queryKey: ['leave-rules'],
    queryFn: () => api.get<LeaveRuleLite[]>('/leave-rules'),
  });

  const mutation = useMutation({
    mutationFn: () => {
      const dto: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        customRoleId: form.customRoleId || null,
        // Tipsoi person identifier — empty string clears it.
        tipsoiPersonId: form.tipsoiPersonId.trim() || null,
        // ID card — empty clears.
        designation: form.designation.trim() || null,
        photoUrl: form.photoUrl || null,
      };
      // Per-staff shift override fields. Sent only when the toggle is
      // on; sending them as null (when toggle is off) clears any
      // previously-set override so the staff member falls back to the
      // branch default rule.
      if (showShift) {
        dto.shiftStart = form.shiftStart.trim() || null;
        dto.shiftEnd = form.shiftEnd.trim() || null;
        dto.lateGraceMinutes = form.lateGraceMinutes.trim() ? parseInt(form.lateGraceMinutes, 10) : null;
        dto.halfDayAfterMinutes = form.halfDayAfterMinutes.trim() ? parseInt(form.halfDayAfterMinutes, 10) : null;
      } else {
        dto.shiftStart = null;
        dto.shiftEnd = null;
        dto.lateGraceMinutes = null;
        dto.halfDayAfterMinutes = null;
      }
      if (form.password) dto.password = form.password;
      dto.canAccessPos = form.canAccessPos;
      dto.canHandleChats = form.canHandleChats;
      // Salary structure + leave rule — empty string clears.
      dto.salaryStructureId = form.salaryStructureId || null;
      dto.leaveRuleId = form.leaveRuleId || null;
      if (initial) {
        dto.isActive = form.isActive;
        return api.patch(`/staff/${initial.id}`, dto);
      }
      dto.password = form.password || 'password123';
      return api.post('/staff', dto);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[440px] p-6  space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">{initial ? 'EDIT' : 'ADD'} STAFF</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          {/* ID card photo — portrait, resized before upload. */}
          <div className="flex items-center gap-4">
            <label className="relative w-20 h-24 shrink-0 border border-dashed border-[#2A2A2A] bg-[#0D0D0D] flex items-center justify-center overflow-hidden cursor-pointer hover:border-[#D62B2B]"
              title="Upload ID card photo">
              {form.photoUrl
                ? <img src={form.photoUrl} alt="Staff photo" className="w-full h-full object-cover" />
                : <Camera size={20} className="text-[#555]" />}
              {uploading && <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] text-white">Uploading…</span>}
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ''; }} />
            </label>
            <div className="text-[10px] text-[#666] font-body space-y-1">
              <p className="text-xs font-medium tracking-widest uppercase text-[#999]">Photo (ID card)</p>
              <p>Click the box to upload. A clear, front-facing portrait works best.</p>
              {form.photoUrl && (
                <button type="button" onClick={() => set('photoUrl', '')} className="text-[#D62B2B] hover:underline">Remove photo</button>
              )}
              {uploadError && <p className="text-[#D62B2B]">{uploadError}</p>}
            </div>
          </div>
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" autoFocus />
          </div>
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Email *</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Role</label>
              <select value={form.role} onChange={(e) => { set('role', e.target.value); set('customRoleId', ''); }}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
              Designation <span className="text-[#555] normal-case tracking-normal">(job title on the ID card)</span>
            </label>
            <input value={form.designation} onChange={(e) => set('designation', e.target.value)}
              placeholder="e.g. Head Chef, Senior Waiter, Barista"
              maxLength={60}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
            <p className="text-[10px] text-[#555] mt-1">Shown on the ID card only. Role above still decides what they can access.</p>
          </div>
          {/* Custom role overlay — optional. Only custom roles whose
              baseRole matches the selected security role appear here. */}
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
              Custom Role <span className="text-[#555] normal-case tracking-normal">(optional overlay)</span>
            </label>
            <select value={form.customRoleId ?? ''} onChange={(e) => set('customRoleId', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white disabled:opacity-50"
              disabled={filteredCustomRoles.length === 0}>
              <option value="">— None ({form.role} default) —</option>
              {filteredCustomRoles.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {filteredCustomRoles.length === 0 && (
              <p className="text-[10px] text-[#555] mt-1">No custom roles defined for {form.role}. Create one in Roles.</p>
            )}
          </div>
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
              {initial ? 'New Password (leave blank to keep)' : 'Password *'}
            </label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
              placeholder={initial ? '••••••' : 'password123'}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>
          {/* ─── Salary + Leave assignment ─────────────────────────────── */}
          <div className="border-t border-[#2A2A2A] pt-4 space-y-3">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Salary & Leave</p>
            <div>
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
                Salary Structure <span className="text-[#555] normal-case tracking-normal">(optional)</span>
              </label>
              <select value={form.salaryStructureId} onChange={(e) => set('salaryStructureId', e.target.value)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white">
                <option value="">— None (use legacy monthlySalary) —</option>
                {salaryStructures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-[10px] text-[#555] mt-1">
                When assigned, payroll generation reads earnings + deductions from this structure and uses its attendance thresholds.
              </p>
            </div>
            <div>
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
                Leave Rule <span className="text-[#555] normal-case tracking-normal">(optional)</span>
              </label>
              <select value={form.leaveRuleId} onChange={(e) => set('leaveRuleId', e.target.value)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white">
                <option value="">— None (no balance tracking) —</option>
                {leaveRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <p className="text-[10px] text-[#555] mt-1">
                Monthly accrual + annual grant run automatically. Leave approval will soft-warn when the request exceeds balance.
              </p>
            </div>
          </div>

          {/* ─── Attendance / Tipsoi ───────────────────────────────────── */}
          <div className="border-t border-[#2A2A2A] pt-4">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-2">Attendance</p>
            <div>
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
                Tipsoi Person Identifier <span className="text-[#555] normal-case tracking-normal">(optional)</span>
              </label>
              <input value={form.tipsoiPersonId} onChange={(e) => set('tipsoiPersonId', e.target.value)}
                placeholder="e.g. Ahmed-1234"
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white font-mono" />
              <p className="text-[10px] text-[#555] mt-1">
                From your Tipsoi device dashboard's people list. Without this, the hourly sync won't write attendance for this staff.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm font-body text-[#999] mt-3">
              <input type="checkbox" checked={showShift} onChange={(e) => setShowShift(e.target.checked)} className="mt-0.5" />
              <span>
                Use custom shift schedule
                <span className="block text-[10px] text-[#666] mt-0.5">
                  Override the branch default attendance rules (Settings → Attendance) for this staff. Leave a field blank to fall back to the branch default for that one rule.
                </span>
              </span>
            </label>
            {showShift && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#999] font-body block mb-1">Shift start (24h)</label>
                  <input type="time" value={form.shiftStart} onChange={(e) => set('shiftStart', e.target.value)}
                    className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
                </div>
                <div>
                  <label className="text-xs text-[#999] font-body block mb-1">Shift end (24h)</label>
                  <input type="time" value={form.shiftEnd} onChange={(e) => set('shiftEnd', e.target.value)}
                    placeholder="end (may cross midnight)"
                    className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
                </div>
                <div>
                  <label className="text-xs text-[#999] font-body block mb-1">Late grace (minutes)</label>
                  <input type="number" min={0} max={240} value={form.lateGraceMinutes}
                    onChange={(e) => set('lateGraceMinutes', e.target.value)}
                    placeholder="e.g. 20"
                    className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
                </div>
                <div>
                  <label className="text-xs text-[#999] font-body block mb-1">Half-day cutoff (minutes)</label>
                  <input type="number" min={0} max={720} value={form.halfDayAfterMinutes}
                    onChange={(e) => set('halfDayAfterMinutes', e.target.value)}
                    placeholder="e.g. 120"
                    className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
                </div>
              </div>
            )}
          </div>

          {initial && (
            <label className="flex items-center gap-2 text-sm font-body text-[#999]">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Active
            </label>
          )}
          <label className="flex items-start gap-2 text-sm font-body text-[#999]">
            <input
              type="checkbox"
              checked={form.canAccessPos}
              onChange={(e) => set('canAccessPos', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Can access POS
              <span className="block text-[10px] text-[#666] mt-0.5">
                Un-check to hide this user from the desktop lock screen + block web POS login. Owner/Manager are always allowed regardless.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm font-body text-[#999]">
            <input
              type="checkbox"
              checked={form.canHandleChats}
              onChange={(e) => set('canHandleChats', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Can handle chats
              <span className="block text-[10px] text-[#666] mt-0.5">
                Lets this user answer customer chats, comments and complaints in the staff chat app (chat.eatrobd.com) and get its notifications. Owner/Manager are always allowed.
              </span>
            </span>
          </label>
        </div>

        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={() => mutation.mutate()}
            disabled={!form.name.trim() || !form.email.trim() || uploading || mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40">
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; staff?: Staff }>({ open: false });

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ['staff'],
    queryFn: () => api.get<Staff[]>('/staff'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/staff/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Management</p>
          <h1 className="font-display text-4xl text-white tracking-wide">STAFF</h1>
        </div>
        <button onClick={() => setDialog({ open: true })}
          className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
          <Plus size={14} /> Add Staff
        </button>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-10 shrink-0 bg-[#0D0D0D] border border-[#2A2A2A] overflow-hidden flex items-center justify-center">
                      {s.photoUrl ? <img src={s.photoUrl} alt="" className="w-full h-full object-cover" /> : <Camera size={12} className="text-[#444]" />}
                    </div>
                    <div>
                      <p className="font-medium text-white">{s.name}</p>
                      {s.designation && <p className="text-[11px] text-[#999]">{s.designation}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-[#999]">{s.email}</td>
                <td className="px-5 py-3 text-[#999]">{s.phone || '—'}</td>
                <td className="px-5 py-3">
                  <span className="text-xs font-medium tracking-widest uppercase text-[#999]">{s.role}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-medium ${s.isActive ? 'text-green-600' : 'text-[#999]'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setDialog({ open: true, staff: s })} className="text-[#999] hover:text-white"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id); }}
                      className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog.open && <StaffDialog initial={dialog.staff} onClose={() => setDialog({ open: false })} />}
    </div>
  );
}
