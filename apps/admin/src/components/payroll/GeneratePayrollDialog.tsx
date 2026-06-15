import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { GeneratePayrollDto } from '@restora/types';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  isActive?: boolean;
}

interface PayrollPrefill {
  baseSalary: number;
  source: 'structure' | 'legacy';
  structure: {
    id: string;
    name: string;
    latesPerAbsent: number;
    halfDaysPerAbsent: number;
    earnings: number;
    deductions: number;
    components: Array<{ name: string; type: 'EARNING' | 'DEDUCTION'; amount: number }>;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, the staff selector is replaced with a read-only label
   *  and prefill auto-fires on mount. Used from the per-staff detail
   *  page so admin can't generate for the wrong person. */
  lockedStaffId?: string;
  /** Invalidation key prefixes to bust after generate succeeds. */
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

const todayPeriod = () => {
  const now = new Date();
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0],
  };
};

export function GeneratePayrollDialog({ open, onClose, lockedStaffId, invalidateKeys = [] }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<GeneratePayrollDto>(() => {
    const { periodStart, periodEnd } = todayPeriod();
    return { staffId: lockedStaffId ?? '', periodStart, periodEnd, baseSalary: 0, deductions: 0, bonuses: 0, notes: '' };
  });
  const [prefill, setPrefill] = useState<PayrollPrefill | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
    select: (d) => d.filter((s: StaffMember) => s.isActive ?? true),
    enabled: open && !lockedStaffId,
  });
  const { data: lockedStaff } = useQuery<StaffMember>({
    queryKey: ['staff', lockedStaffId],
    queryFn: () => api.get(`/staff/${lockedStaffId}`),
    enabled: open && !!lockedStaffId,
  });

  const generateMutation = useMutation({
    mutationFn: (dto: GeneratePayrollDto) =>
      api.post('/payroll', {
        ...dto,
        baseSalary: Math.round((dto.baseSalary || 0) * 100),
        deductions: Math.round((dto.deductions || 0) * 100),
        bonuses: Math.round((dto.bonuses || 0) * 100),
      }),
    onSuccess: () => {
      for (const key of invalidateKeys) void qc.invalidateQueries({ queryKey: key as unknown[] });
      onClose();
    },
  });

  const fetchPrefill = async (staffId: string) => {
    if (!staffId) return;
    try {
      setPrefillLoading(true);
      const data = await api.get<PayrollPrefill>(`/payroll/prefill/${staffId}`);
      setPrefill(data);
      setForm((f) => ({ ...f, baseSalary: data.baseSalary }));
    } finally {
      setPrefillLoading(false);
    }
  };

  // Reset + auto-prefill when opened
  useEffect(() => {
    if (!open) return;
    const { periodStart, periodEnd } = todayPeriod();
    const initial: GeneratePayrollDto = {
      staffId: lockedStaffId ?? '',
      periodStart,
      periodEnd,
      baseSalary: 0,
      deductions: 0,
      bonuses: 0,
      notes: '',
    };
    setForm(initial);
    setPrefill(null);
    if (lockedStaffId) void fetchPrefill(lockedStaffId);
  }, [open, lockedStaffId]);

  const handleStaffChange = async (staffId: string) => {
    setForm((f) => ({ ...f, staffId, baseSalary: 0 }));
    setPrefill(null);
    if (staffId) await fetchPrefill(staffId);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-white tracking-widest mb-6">GENERATE PAYROLL</h2>
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Staff Member *</label>
            {lockedStaffId ? (
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body">
                {lockedStaff ? `${lockedStaff.name} (${lockedStaff.role})` : 'Loading…'}
              </div>
            ) : (
              <select
                value={form.staffId}
                onChange={(e) => handleStaffChange(e.target.value)}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              >
                <option value="">— Select Staff —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Period Start *</label>
              <input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Period End *</label>
              <input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              />
            </div>
          </div>
          {(['baseSalary', 'deductions', 'bonuses'] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
                {key === 'baseSalary' ? 'Base Salary (৳) *' : key === 'deductions' ? 'Deductions (৳) — ad-hoc' : 'Bonuses (৳)'}
              </label>
              <input
                type="number"
                min="0"
                value={form[key] as number}
                onChange={(e) => setForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              />
              {key === 'baseSalary' && form.staffId && (
                <p className="text-[10px] font-body mt-0.5 text-[#666]">
                  {prefillLoading && 'Loading…'}
                  {!prefillLoading && prefill?.source === 'structure' && (
                    <>
                      From structure <span className="text-[#DDD9D3]">"{prefill.structure!.name}"</span>: earnings ৳
                      {prefill.structure!.earnings.toLocaleString()}, structure deductions ৳{prefill.structure!.deductions.toLocaleString()} (auto-applied on
                      submit).
                    </>
                  )}
                  {!prefillLoading && prefill?.source === 'legacy' && prefill.baseSalary > 0 && (
                    <>
                      From legacy <span className="text-[#DDD9D3]">monthlySalary</span>. Assign a salary structure for breakdown + thresholds.
                    </>
                  )}
                  {!prefillLoading && prefill?.source === 'legacy' && prefill.baseSalary === 0 && (
                    <span className="text-[#FFA726]">No salary structure or legacy monthlySalary set for this staff. Type a value manually.</span>
                  )}
                </p>
              )}
              {key === 'deductions' && prefill?.structure && prefill.structure.deductions > 0 && (
                <p className="text-[10px] font-body mt-0.5 text-[#666]">
                  Structure already deducts ৳{prefill.structure.deductions.toLocaleString()}. This field adds extra one-off deductions on top.
                </p>
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
            <input
              value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
          </div>
        </div>
        {generateMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(generateMutation.error as Error).message}</p>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => generateMutation.mutate(form)}
            disabled={!form.staffId || !form.periodStart || !form.periodEnd || generateMutation.isPending}
            className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
          >
            {generateMutation.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
