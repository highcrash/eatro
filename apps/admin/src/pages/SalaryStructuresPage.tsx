import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Users, X, ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../lib/api';

type ComponentType = 'EARNING' | 'DEDUCTION';

interface Component {
  id?: string;
  name: string;
  type: ComponentType;
  amount: number;
  sortOrder: number;
}

interface Structure {
  id: string;
  name: string;
  notes: string | null;
  latesPerAbsent: number;
  halfDaysPerAbsent: number;
  components: Component[];
  assignedStaffCount: number;
  createdAt?: string;
  updatedAt?: string;
}

interface StaffLite {
  id: string;
  name: string;
  role: string;
  salaryStructureId?: string | null;
}

export default function SalaryStructuresPage() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Structure | null>(null);

  const { data: structures = [], isLoading } = useQuery<Structure[]>({
    queryKey: ['salary-structures'],
    queryFn: () => api.get('/salary-structures'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/salary-structures/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['salary-structures'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">SALARY STRUCTURES</h1>
          <p className="text-xs text-[#999] mt-1">
            Named bundles of earnings + deductions + attendance thresholds. Assign one to a staff member and payroll generation reads from it.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-sm hover:bg-[#b51e1e]"
        >
          <Plus size={14} /> New Structure
        </button>
      </div>

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {!isLoading && structures.length === 0 && (
        <div className="border border-[#2A2A2A] p-8 text-center text-[#666] text-sm">
          No salary structures yet. Click "New Structure" to create one.
        </div>
      )}

      {structures.length > 0 && (
        <div className="border border-[#2A2A2A] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] bg-[#161616]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Components</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-center">Thresholds</th>
                <th className="px-4 py-3 text-right">Staff</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => {
                const gross = s.components.filter((c) => c.type === 'EARNING').reduce((a, c) => a + c.amount, 0);
                const ded = s.components.filter((c) => c.type === 'DEDUCTION').reduce((a, c) => a + c.amount, 0);
                return (
                  <tr key={s.id} className="border-t border-[#2A2A2A] hover:bg-[#161616]">
                    <td className="px-4 py-3 text-white">
                      {s.name}
                      {s.notes && <p className="text-[10px] text-[#666] mt-0.5 max-w-md truncate">{s.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-[#999]">{s.components.length}</td>
                    <td className="px-4 py-3 text-right text-[#4CAF50]">{gross.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-[#FFA726]">{ded.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">{(gross - ded).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-[10px] text-[#999]">
                      {s.latesPerAbsent}L = 1A · {s.halfDaysPerAbsent}H = 1A
                    </td>
                    <td className="px-4 py-3 text-right text-[#DDD9D3]">{s.assignedStaffCount}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setAssignFor(s)}
                        className="text-[#999] hover:text-[#4CAF50] mr-2"
                        title="Assign to staff"
                      >
                        <Users size={14} />
                      </button>
                      <button
                        onClick={() => setOpenId(s.id)}
                        className="text-[#999] hover:text-[#FFA726] mr-2"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (s.assignedStaffCount > 0) {
                            alert(`Unassign the ${s.assignedStaffCount} staff first.`);
                            return;
                          }
                          if (confirm(`Delete "${s.name}"?`)) removeMutation.mutate(s.id);
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
        <StructureDialog
          initial={creating ? null : structures.find((s) => s.id === openId) ?? null}
          onClose={() => {
            setOpenId(null);
            setCreating(false);
          }}
        />
      )}

      {assignFor && (
        <AssignDialog structure={assignFor} onClose={() => setAssignFor(null)} />
      )}
    </div>
  );
}

function StructureDialog({ initial, onClose }: { initial: Structure | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [latesPerAbsent, setLatesPerAbsent] = useState(String(initial?.latesPerAbsent ?? 3));
  const [halfDaysPerAbsent, setHalfDaysPerAbsent] = useState(String(initial?.halfDaysPerAbsent ?? 2));
  const [components, setComponents] = useState<Component[]>(
    initial?.components.length
      ? initial.components.map((c, i) => ({ ...c, sortOrder: i }))
      : [{ name: 'Basic Pay', type: 'EARNING', amount: 0, sortOrder: 0 }],
  );
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const gross = components.filter((c) => c.type === 'EARNING').reduce((a, c) => a + (c.amount || 0), 0);
    const ded = components.filter((c) => c.type === 'DEDUCTION').reduce((a, c) => a + (c.amount || 0), 0);
    return { gross, ded, net: gross - ded };
  }, [components]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      isEdit
        ? api.patch(`/salary-structures/${initial!.id}`, body)
        : api.post('/salary-structures', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-structures'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateComp = (i: number, patch: Partial<Component>) =>
    setComponents((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeComp = (i: number) => setComponents((cs) => cs.filter((_, idx) => idx !== i));
  const addComp = (type: ComponentType) =>
    setComponents((cs) => [...cs, { name: '', type, amount: 0, sortOrder: cs.length }]);
  const moveComp = (i: number, dir: -1 | 1) => {
    const next = [...components];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setComponents(next.map((c, idx) => ({ ...c, sortOrder: idx })));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate({
      name: name.trim(),
      notes: notes.trim() || undefined,
      latesPerAbsent: Number(latesPerAbsent) || 3,
      halfDaysPerAbsent: Number(halfDaysPerAbsent) || 2,
      components: components.map((c, i) => ({
        name: c.name.trim(),
        type: c.type,
        amount: Number(c.amount) || 0,
        sortOrder: i,
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
          <h2 className="text-lg font-bold text-white">
            {isEdit ? 'Edit' : 'New'} Salary Structure
          </h2>
          <button type="button" onClick={onClose} className="text-[#666] hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Senior Chef Standard"
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

          <div className="grid grid-cols-2 gap-4">
            <Field label="Lates per absent (default 3)">
              <input
                type="number"
                min={1}
                value={latesPerAbsent}
                onChange={(e) => setLatesPerAbsent(e.target.value)}
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D62B2B]"
              />
            </Field>
            <Field label="Half-days per absent (default 2)">
              <input
                type="number"
                min={1}
                value={halfDaysPerAbsent}
                onChange={(e) => setHalfDaysPerAbsent(e.target.value)}
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D62B2B]"
              />
            </Field>
          </div>

          <div className="border border-[#2A2A2A]">
            <div className="px-4 py-2 bg-[#161616] flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-[#888]">Components</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addComp('EARNING')}
                  className="text-xs text-[#4CAF50] border border-[#4CAF50] px-2 py-1 hover:bg-[#4CAF50] hover:text-white"
                >
                  + Earning
                </button>
                <button
                  type="button"
                  onClick={() => addComp('DEDUCTION')}
                  className="text-xs text-[#FFA726] border border-[#FFA726] px-2 py-1 hover:bg-[#FFA726] hover:text-black"
                >
                  + Deduction
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-[#888]">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-32">Type</th>
                  <th className="px-3 py-2 text-right w-32">Amount</th>
                  <th className="px-3 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => (
                  <tr key={i} className="border-t border-[#2A2A2A]">
                    <td className="px-3 py-2">
                      <input
                        value={c.name}
                        onChange={(e) => updateComp(i, { name: e.target.value })}
                        required
                        placeholder="e.g. Basic Pay"
                        className="w-full bg-transparent border-b border-[#2A2A2A] text-white px-1 py-1 text-sm focus:outline-none focus:border-[#D62B2B]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.type}
                        onChange={(e) => updateComp(i, { type: e.target.value as ComponentType })}
                        className={`bg-[#161616] border border-[#2A2A2A] px-2 py-1 text-xs ${c.type === 'EARNING' ? 'text-[#4CAF50]' : 'text-[#FFA726]'}`}
                      >
                        <option value="EARNING">EARNING</option>
                        <option value="DEDUCTION">DEDUCTION</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={c.amount}
                        onChange={(e) => updateComp(i, { amount: Number(e.target.value) })}
                        className="w-full bg-transparent border-b border-[#2A2A2A] text-white px-1 py-1 text-sm text-right focus:outline-none focus:border-[#D62B2B]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => moveComp(i, -1)} className="text-[#666] hover:text-white p-1" title="Move up">
                        <ArrowUp size={12} />
                      </button>
                      <button type="button" onClick={() => moveComp(i, 1)} className="text-[#666] hover:text-white p-1" title="Move down">
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeComp(i)}
                        className="text-[#666] hover:text-[#D62B2B] p-1"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#2A2A2A] bg-[#0a0a0a] text-xs">
                  <td colSpan={2} className="px-3 py-2 uppercase tracking-widest text-[#888]">Net</td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-[#4CAF50]">+{totals.gross.toLocaleString()}</span>
                    <span className="text-[#888] mx-1">−</span>
                    <span className="text-[#FFA726]">{totals.ded.toLocaleString()}</span>
                    <span className="text-[#888] mx-1">=</span>
                    <span className="text-white font-medium">{totals.net.toLocaleString()}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

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

function AssignDialog({ structure, onClose }: { structure: Structure; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: allStaff = [] } = useQuery<StaffLite[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
  });
  const initialAssigned = useMemo(
    () => allStaff.filter((s) => s.salaryStructureId === structure.id).map((s) => s.id),
    [allStaff, structure.id],
  );
  const [selected, setSelected] = useState<string[]>(initialAssigned);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/salary-structures/${structure.id}/assign`, { staffIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['salary-structures'] });
      onClose();
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-lg max-h-[80vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-bold text-white">Assign — {structure.name}</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>
        <div className="overflow-y-auto p-4 space-y-1 flex-1">
          {allStaff.map((s) => {
            const otherAssignment = s.salaryStructureId && s.salaryStructureId !== structure.id;
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
                {otherAssignment && (
                  <span className="text-[10px] text-[#FFA726]">Currently on another structure</span>
                )}
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
