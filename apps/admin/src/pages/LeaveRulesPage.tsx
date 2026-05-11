import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users, X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

const LEAVE_TYPES = ['SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'OTHER'] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];

interface Entry {
  id?: string;
  leaveType: LeaveType;
  accrualPerMonth: number;
  annualGrant: number;
  balanceCap: number | null;
}

interface Rule {
  id: string;
  name: string;
  notes: string | null;
  entries: Entry[];
  assignedStaffCount: number;
}

interface StaffLite {
  id: string;
  name: string;
  role: string;
  leaveRuleId?: string | null;
}

export default function LeaveRulesPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Rule | null>(null);

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ['leave-rules'],
    queryFn: () => api.get('/leave-rules'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-rules'] }),
  });

  const accrue = useMutation({
    mutationFn: () => api.post('/leave-balances/accrue', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-balances'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">LEAVE RULES</h1>
          <p className="text-xs text-[#999] mt-1">
            Per-leave-type accrual policy assigned to staff. The 1st-of-month cron credits monthly accruals; Jan 1 credits the upfront annual grant.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => accrue.mutate()}
          disabled={accrue.isPending}
          className="flex items-center gap-2 bg-[#161616] border border-[#2A2A2A] text-[#DDD9D3] px-4 py-2 text-sm hover:border-[#444] disabled:opacity-50"
          title="Run accrual immediately for all staff with rules assigned"
        >
          <RefreshCw size={14} className={accrue.isPending ? 'animate-spin' : ''} /> Run Accrual Now
        </button>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-sm hover:bg-[#b51e1e]"
        >
          <Plus size={14} /> New Rule
        </button>
      </div>

      {accrue.data != null && (
        <div className="border border-[#4CAF50]/30 bg-[#4CAF50]/10 text-[#4CAF50] px-4 py-2 text-xs">
          Accrual ran: {(accrue.data as { monthlyCredited: number; annualCredited: number }).monthlyCredited} monthly + {(accrue.data as { monthlyCredited: number; annualCredited: number }).annualCredited} annual balance(s) credited.
        </div>
      )}

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {!isLoading && rules.length === 0 && (
        <div className="border border-[#2A2A2A] p-8 text-center text-[#666] text-sm">
          No leave rules yet. Click "New Rule" — typical setup is "Paid Leave 4/month, Sick 12/year upfront".
        </div>
      )}

      {rules.length > 0 && (
        <div className="border border-[#2A2A2A] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] bg-[#161616]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Entries</th>
                <th className="px-4 py-3 text-right">Monthly Total</th>
                <th className="px-4 py-3 text-right">Annual Total</th>
                <th className="px-4 py-3 text-right">Staff</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const monthly = r.entries.reduce((a, e) => a + e.accrualPerMonth, 0);
                const annual = r.entries.reduce((a, e) => a + e.annualGrant, 0);
                return (
                  <tr key={r.id} className="border-t border-[#2A2A2A] hover:bg-[#161616]">
                    <td className="px-4 py-3 text-white">
                      {r.name}
                      {r.notes && <p className="text-[10px] text-[#666] mt-0.5 max-w-md truncate">{r.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-[#999]">
                      {r.entries.map((e) => `${e.leaveType.replace(/_/g, ' ')}`).join(' · ')}
                    </td>
                    <td className="px-4 py-3 text-right text-[#4CAF50]">{monthly.toFixed(2)} d/mo</td>
                    <td className="px-4 py-3 text-right text-[#FFA726]">{annual} d/yr</td>
                    <td className="px-4 py-3 text-right text-[#DDD9D3]">{r.assignedStaffCount}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setAssignFor(r)} className="text-[#999] hover:text-[#4CAF50] mr-2" title="Assign">
                        <Users size={14} />
                      </button>
                      <button onClick={() => setOpenId(r.id)} className="text-[#999] hover:text-[#FFA726] mr-2" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (r.assignedStaffCount > 0) {
                            alert(`Unassign the ${r.assignedStaffCount} staff first.`);
                            return;
                          }
                          if (confirm(`Delete "${r.name}"?`)) removeMutation.mutate(r.id);
                        }}
                        className="text-[#999] hover:text-[#D62B2B]"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(openId || creating) && (
        <RuleDialog
          initial={creating ? null : rules.find((r) => r.id === openId) ?? null}
          onClose={() => {
            setOpenId(null);
            setCreating(false);
          }}
        />
      )}

      {assignFor && <AssignDialog rule={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function RuleDialog({ initial, onClose }: { initial: Rule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [entries, setEntries] = useState<Entry[]>(
    initial?.entries.length
      ? initial.entries
      : [{ leaveType: 'CASUAL', accrualPerMonth: 4, annualGrant: 0, balanceCap: null }],
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      isEdit
        ? api.patch(`/leave-rules/${initial!.id}`, body)
        : api.post('/leave-rules', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-rules'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateEntry = (i: number, patch: Partial<Entry>) =>
    setEntries((es) => es.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const removeEntry = (i: number) => setEntries((es) => es.filter((_, idx) => idx !== i));
  const usedTypes = useMemo(() => new Set(entries.map((e) => e.leaveType)), [entries]);
  const availableType = (current: LeaveType): LeaveType[] =>
    LEAVE_TYPES.filter((t) => t === current || !usedTypes.has(t));

  const addEntry = () => {
    const free = LEAVE_TYPES.find((t) => !usedTypes.has(t));
    if (!free) return;
    setEntries((es) => [...es, { leaveType: free, accrualPerMonth: 0, annualGrant: 0, balanceCap: null }]);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate({
      name: name.trim(),
      notes: notes.trim() || undefined,
      entries: entries.map((en) => ({
        leaveType: en.leaveType,
        accrualPerMonth: Number(en.accrualPerMonth) || 0,
        annualGrant: Number(en.annualGrant) || 0,
        balanceCap: en.balanceCap == null || en.balanceCap === 0 ? null : Number(en.balanceCap),
      })),
    });
  };

  return (
    <Backdrop onClose={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-bold text-white">{isEdit ? 'Edit' : 'New'} Leave Rule</h2>
          <button type="button" onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>

        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Standard Staff"
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D62B2B]"
              />
            </Field>
            <Field label="Notes">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D62B2B]"
              />
            </Field>
          </div>

          <div className="border border-[#2A2A2A]">
            <div className="px-4 py-2 bg-[#161616] flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-[#888]">Entries</span>
              <button
                type="button"
                onClick={addEntry}
                disabled={usedTypes.size >= LEAVE_TYPES.length}
                className="text-xs text-[#4CAF50] border border-[#4CAF50] px-2 py-1 hover:bg-[#4CAF50] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                + Entry
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-[#888]">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Per Month</th>
                  <th className="px-3 py-2 text-right">Annual Grant</th>
                  <th className="px-3 py-2 text-right">Balance Cap</th>
                  <th className="px-3 py-2 w-12" />
                </tr>
              </thead>
              <tbody>
                {entries.map((en, i) => (
                  <tr key={i} className="border-t border-[#2A2A2A]">
                    <td className="px-3 py-2">
                      <select
                        value={en.leaveType}
                        onChange={(ev) => updateEntry(i, { leaveType: ev.target.value as LeaveType })}
                        className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1 text-xs"
                      >
                        {availableType(en.leaveType).map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.25"
                        value={en.accrualPerMonth}
                        onChange={(ev) => updateEntry(i, { accrualPerMonth: Number(ev.target.value) })}
                        className="w-full bg-transparent border-b border-[#2A2A2A] text-white px-1 py-1 text-sm text-right focus:outline-none focus:border-[#D62B2B]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={en.annualGrant}
                        onChange={(ev) => updateEntry(i, { annualGrant: Number(ev.target.value) })}
                        className="w-full bg-transparent border-b border-[#2A2A2A] text-white px-1 py-1 text-sm text-right focus:outline-none focus:border-[#D62B2B]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        placeholder="∞"
                        value={en.balanceCap ?? ''}
                        onChange={(ev) => updateEntry(i, { balanceCap: ev.target.value === '' ? null : Number(ev.target.value) })}
                        className="w-full bg-transparent border-b border-[#2A2A2A] text-white px-1 py-1 text-sm text-right focus:outline-none focus:border-[#D62B2B]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => removeEntry(i)} className="text-[#666] hover:text-[#D62B2B]" title="Remove">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-[#666]">
            <strong className="text-[#888]">Per Month</strong> credits on the 1st of every month (e.g. 4 for paid leave).
            <strong className="text-[#888] ml-2">Annual Grant</strong> credits once on Jan 1 (e.g. 12 for sick leave upfront).
            Use one or both per type. Balance Cap optional — leave blank for unlimited.
          </p>

          {error && <p className="text-[#ff6b6b] text-xs">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 p-4 border-t border-[#2A2A2A]">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </button>
        </footer>
      </form>
    </Backdrop>
  );
}

function AssignDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: allStaff = [] } = useQuery<StaffLite[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
  });
  const initialAssigned = useMemo(
    () => allStaff.filter((s) => s.leaveRuleId === rule.id).map((s) => s.id),
    [allStaff, rule.id],
  );
  const [selected, setSelected] = useState<string[]>(initialAssigned);

  const save = useMutation({
    mutationFn: () => api.post(`/leave-rules/${rule.id}/assign`, { staffIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['leave-rules'] });
      onClose();
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-lg max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-bold text-white">Assign — {rule.name}</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>
        <div className="overflow-y-auto p-4 space-y-1 flex-1">
          {allStaff.map((s) => {
            const otherAssignment = s.leaveRuleId && s.leaveRuleId !== rule.id;
            return (
              <label
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 bg-[#161616] border border-[#2A2A2A] cursor-pointer hover:border-[#444]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-[#D62B2B]"
                />
                <div className="flex-1">
                  <p className="text-sm text-white">{s.name}</p>
                  <p className="text-[10px] text-[#666] uppercase tracking-widest">{s.role}</p>
                </div>
                {otherAssignment && <span className="text-[10px] text-[#FFA726]">On another rule</span>}
              </label>
            );
          })}
        </div>
        <footer className="flex justify-between items-center p-4 border-t border-[#2A2A2A]">
          <p className="text-xs text-[#888]">{selected.length} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save Assignment'}
            </button>
          </div>
        </footer>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-[#888] mb-1 block">{label}</span>
      {children}
    </label>
  );
}
