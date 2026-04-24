import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

import { api } from '../lib/api';

interface Staff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  customRoleId?: string | null;
  isActive: boolean;
  canAccessPos: boolean;
  hireDate: string;
}

interface CustomRoleLite {
  id: string;
  name: string;
  baseRole: string;
  description?: string | null;
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
  });
  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  // Custom roles the admin may assign. Filter to ones whose baseRole
  // matches the selected role — a "Head Chef" (base=KITCHEN) shouldn't
  // be assignable to a staff currently on role=CASHIER.
  const { data: customRoles = [] } = useQuery<CustomRoleLite[]>({
    queryKey: ['custom-roles'],
    queryFn: () => api.get<CustomRoleLite[]>('/custom-roles'),
  });
  const filteredCustomRoles = customRoles.filter((c) => c.baseRole === form.role);

  const mutation = useMutation({
    mutationFn: () => {
      const dto: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        customRoleId: form.customRoleId || null,
      };
      if (form.password) dto.password = form.password;
      dto.canAccessPos = form.canAccessPos;
      if (initial) {
        dto.isActive = form.isActive;
        return api.patch(`/staff/${initial.id}`, dto);
      }
      dto.password = form.password || 'change-me-on-first-login';
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
              placeholder={initial ? '••••••' : 'change-me-on-first-login'}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
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
        </div>

        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={() => mutation.mutate()}
            disabled={!form.name.trim() || !form.email.trim() || mutation.isPending}
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
                <td className="px-5 py-3 font-medium text-white">{s.name}</td>
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
