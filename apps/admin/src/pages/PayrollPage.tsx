import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Payroll, GeneratePayrollDto, PayrollStatus } from '@restora/types';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  monthlySalary: number | null;
}

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'text-[#FFA726] bg-[#3a2e00]',
  APPROVED: 'text-[#29B6F6] bg-[#00243a]',
  PAID: 'text-[#4CAF50] bg-[#1a3a1a]',
};

// ─── Payroll Ledger Modal ────────────────────────────────────────────────────

function PayrollLedger({ payroll, onClose }: { payroll: Payroll; onClose: () => void }) {
  const { data: payments = [] } = useQuery<{ id: string; amount: number; paymentMethod: string; reference: string | null; notes: string | null; createdAt: string; paidBy?: { name: string } }[]>({
    queryKey: ['payroll-payments', payroll.id],
    queryFn: () => api.get(`/payroll/${payroll.id}/payments`),
  });

  const totalDays = Math.round((new Date(payroll.periodEnd).getTime() - new Date(payroll.periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const baseSalary = Number(payroll.baseSalary);
  const deductions = Number(payroll.deductions);
  const bonuses = Number(payroll.bonuses);
  const netPayable = Number(payroll.netPayable);
  const paidAmount = Number(payroll.paidAmount);
  const remaining = netPayable - paidAmount;

  const handlePrint = () => {
    const paymentRows = payments.map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td>${new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${p.paymentMethod}</td>
      <td>${p.reference || '—'}</td>
      <td>${p.paidBy?.name || '—'}</td>
      <td>${p.notes || '—'}</td>
      <td class="r">${formatCurrency(Number(p.amount))}</td>
    </tr>`).join('');

    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Payroll — ${payroll.staff?.name}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#111;padding:24px;max-width:800px;margin:0 auto}
        h1{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px}
        h2{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;margin:20px 0 8px;border-bottom:1px solid #DDD;padding-bottom:4px}
        .meta{font-size:11px;color:#666;margin:4px 0 16px}.meta span{margin-right:16px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0 20px;font-size:12px}
        .grid .label{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:1px}
        .grid .value{font-weight:600;font-size:14px}
        .grid .green{color:#2e7d32}.grid .red{color:#c62828}
        table{width:100%;border-collapse:collapse;margin:8px 0}
        th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:6px 4px;font-weight:600}
        td{padding:5px 4px;border-bottom:1px solid #F2F1EE;font-size:11px}
        .r{text-align:right}
        .total td{border-top:2px solid #111;font-weight:700;font-size:12px;padding-top:8px}
        .badge{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:1px;padding:2px 8px;font-weight:600}
        .notes{font-size:11px;color:#666;font-style:italic;margin-top:12px;padding:8px;background:#f5f5f5}
        @media print{body{padding:10mm}}
      </style></head><body>
      <h1>PAYROLL SLIP</h1>
      <div class="meta">
        <span>Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </div>

      <h2>EMPLOYEE DETAILS</h2>
      <div class="grid">
        <div><div class="label">Name</div><div class="value">${payroll.staff?.name || '—'}</div></div>
        <div><div class="label">Role</div><div class="value">${payroll.staff?.role || '—'}</div></div>
        <div><div class="label">Period</div><div class="value">${new Date(payroll.periodStart).toLocaleDateString('en-GB')} — ${new Date(payroll.periodEnd).toLocaleDateString('en-GB')}</div></div>
        <div><div class="label">Status</div><div class="value"><span class="badge" style="background:${payroll.status === 'PAID' ? '#e8f5e9' : payroll.status === 'APPROVED' ? '#e3f2fd' : '#fff3e0'}">${payroll.status}</span></div></div>
      </div>

      <h2>SALARY BREAKDOWN</h2>
      <div class="grid">
        <div><div class="label">Base Salary</div><div class="value">${formatCurrency(baseSalary)}</div></div>
        <div><div class="label">Attendance</div><div class="value">${payroll.daysPresent} present / ${payroll.daysAbsent} absent / ${totalDays} days</div></div>
        <div><div class="label">Deductions</div><div class="value red">${deductions > 0 ? '-' + formatCurrency(deductions) : '—'}</div></div>
        <div><div class="label">Bonuses</div><div class="value green">${bonuses > 0 ? '+' + formatCurrency(bonuses) : '—'}</div></div>
        <div><div class="label">Net Payable</div><div class="value" style="font-size:18px">${formatCurrency(netPayable)}</div></div>
        <div><div class="label">Paid</div><div class="value green">${formatCurrency(paidAmount)}</div></div>
      </div>

      ${payroll.notes ? `<div class="notes">Notes: ${payroll.notes}</div>` : ''}

      ${payments.length > 0 ? `
        <h2>PAYMENT HISTORY</h2>
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th>Paid By</th><th>Notes</th><th class="r">Amount</th></tr></thead>
          <tbody>
            ${paymentRows}
            <tr class="total"><td colspan="6">Total Paid</td><td class="r">${formatCurrency(paidAmount)}</td></tr>
            ${remaining > 0 ? `<tr><td colspan="6" style="color:#c62828">Remaining</td><td class="r" style="color:#c62828">${formatCurrency(remaining)}</td></tr>` : ''}
          </tbody>
        </table>
      ` : '<p style="color:#666;margin-top:16px">No payments recorded yet.</p>'}

      <div style="margin-top:40px;display:flex;justify-content:space-between">
        <div style="text-align:center;width:200px"><div style="border-top:1px solid #333;padding-top:4px;font-size:10px;color:#666">Employee Signature</div></div>
        <div style="text-align:center;width:200px"><div style="border-top:1px solid #333;padding-top:4px;font-size:10px;color:#666">Authorized Signature</div></div>
      </div>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#161616] w-[600px] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-[#161616] px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between z-10">
          <div>
            <h3 className="font-display text-2xl text-white tracking-wide">PAYROLL LEDGER</h3>
            <p className="text-xs font-body text-[#666] mt-0.5">{payroll.staff?.name} — {payroll.staff?.role}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="text-[#999] hover:text-white p-1.5" title="Print"><Printer size={16} /></button>
            <button onClick={onClose} className="text-[#999] hover:text-white p-1.5"><X size={16} /></button>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-4 space-y-4">
          {/* Status + Period */}
          <div className="flex items-center justify-between">
            <span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[payroll.status]}`}>{payroll.status}</span>
            <span className="text-xs font-body text-[#666]">
              {new Date(payroll.periodStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} — {new Date(payroll.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>

          {/* Salary Breakdown */}
          <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4 space-y-2">
            <div className="flex justify-between text-sm font-body">
              <span className="text-[#666]">Base Salary</span>
              <span className="text-white">{formatCurrency(baseSalary)}</span>
            </div>
            <div className="flex justify-between text-sm font-body">
              <span className="text-[#666]">Attendance</span>
              <span><span className="text-white">{payroll.daysPresent}P</span> / <span className="text-[#D62B2B]">{payroll.daysAbsent}A</span> / <span className="text-[#666]">{totalDays}d</span></span>
            </div>
            {deductions > 0 && (
              <div className="flex justify-between text-sm font-body">
                <span className="text-[#666]">Deductions</span>
                <span className="text-[#D62B2B]">-{formatCurrency(deductions)}</span>
              </div>
            )}
            {bonuses > 0 && (
              <div className="flex justify-between text-sm font-body">
                <span className="text-[#666]">Bonuses</span>
                <span className="text-[#4CAF50]">+{formatCurrency(bonuses)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-body font-medium border-t border-[#2A2A2A] pt-2">
              <span className="text-white">Net Payable</span>
              <span className="text-white font-display text-xl tracking-wide">{formatCurrency(netPayable)}</span>
            </div>
            <div className="flex justify-between text-sm font-body">
              <span className="text-[#666]">Paid</span>
              <span className="text-[#4CAF50]">{formatCurrency(paidAmount)}</span>
            </div>
            {remaining > 0 && (
              <div className="flex justify-between text-sm font-body">
                <span className="text-[#666]">Remaining</span>
                <span className="text-[#D62B2B]">{formatCurrency(remaining)}</span>
              </div>
            )}
          </div>

          {/* Notes */}
          {payroll.notes && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3">
              <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">Notes</p>
              <p className="text-sm font-body text-[#999] whitespace-pre-wrap">{payroll.notes}</p>
            </div>
          )}

          {/* Payment History */}
          <div>
            <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-2">Payment History</p>
            {payments.length === 0 ? (
              <p className="text-sm font-body text-[#555]">No payments recorded yet.</p>
            ) : (
              <div className="bg-[#0D0D0D] border border-[#2A2A2A]">
                <table className="w-full text-sm font-body">
                  <thead>
                    <tr className="text-left text-xs text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Method</th>
                      <th className="px-3 py-2 font-medium">Ref</th>
                      <th className="px-3 py-2 font-medium">By</th>
                      <th className="px-3 py-2 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={p.id} className="border-b border-[#2A2A2A]/50 last:border-0">
                        <td className="px-3 py-2 text-[#666]">{i + 1}</td>
                        <td className="px-3 py-2 text-[#999]">{new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                        <td className="px-3 py-2 text-[#999]">{p.paymentMethod}</td>
                        <td className="px-3 py-2 text-[#666]">{p.reference || '—'}</td>
                        <td className="px-3 py-2 text-[#999]">{p.paidBy?.name || '—'}</td>
                        <td className="px-3 py-2 text-right text-[#4CAF50] font-medium">{formatCurrency(Number(p.amount))}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#161616]">
                      <td colSpan={5} className="px-3 py-2 text-xs font-medium text-white tracking-widest uppercase">Total Paid</td>
                      <td className="px-3 py-2 text-right text-[#4CAF50] font-medium">{formatCurrency(paidAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const qc = useQueryClient();
  const { data: paymentOptions = [] } = useQuery<{ code: string; name: string; isActive: boolean; category?: { code: string; name: string } }[]>({
    queryKey: ['payment-options'],
    queryFn: () => api.get('/payment-methods/options'),
    select: (d: any[]) => d.filter((o) => o.isActive),
  });
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [genForm, setGenForm] = useState<GeneratePayrollDto>({
    staffId: '',
    periodStart: '',
    periodEnd: '',
    baseSalary: 0,
    deductions: 0,
    bonuses: 0,
    notes: '',
  });

  const { data: payrolls = [], isLoading } = useQuery<Payroll[]>({
    queryKey: ['payrolls'],
    queryFn: () => api.get('/payroll'),
  });

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
    select: (d) => d.filter((s: StaffMember & { isActive?: boolean }) => s.isActive ?? true),
  });

  const generateMutation = useMutation({
    mutationFn: (dto: GeneratePayrollDto) => api.post('/payroll', {
      ...dto,
      baseSalary: Math.round((dto.baseSalary || 0) * 100),
      deductions: Math.round((dto.deductions || 0) * 100),
      bonuses: Math.round((dto.bonuses || 0) * 100),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payrolls'] });
      setShowGenDialog(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/${id}/approve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payrolls'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payrolls'] }),
  });

  const [ledgerPayroll, setLedgerPayroll] = useState<Payroll | null>(null);
  const [payingPayroll, setPayingPayroll] = useState<Payroll | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', paymentMethod: 'CASH', reference: '', notes: '' });

  const payMutation = useMutation({
    mutationFn: () => api.post(`/payroll/${payingPayroll!.id}/pay`, {
      amount: Math.round(parseFloat(payForm.amount) * 100),
      paymentMethod: payForm.paymentMethod,
      reference: payForm.reference || undefined,
      notes: payForm.notes || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payrolls'] });
      setPayingPayroll(null);
    },
  });

  const openGen = () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    setGenForm({ staffId: '', periodStart, periodEnd, baseSalary: 0, deductions: 0, bonuses: 0, notes: '' });
    setShowGenDialog(true);
  };

  const handleStaffChange = (staffId: string) => {
    const s = staff.find((st) => st.id === staffId);
    setGenForm((f) => ({ ...f, staffId, baseSalary: (s?.monthlySalary ?? 0) / 100 }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">PAYROLL</h1>
        <button onClick={openGen} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
          + GENERATE PAYROLL
        </button>
      </div>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading…</p>
      ) : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Staff', 'Period', 'Base Salary', 'Attendance', 'Deductions', 'Bonuses', 'Net Payable', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payrolls.map((p) => {
                const totalDays = Math.round((new Date(p.periodEnd).getTime() - new Date(p.periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const isProRated = p.daysPresent > 0 && p.daysPresent < totalDays;
                return (
                <tr key={p.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-white font-body text-sm">{p.staff?.name}</td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">
                    {new Date(p.periodStart).toLocaleDateString()} — {new Date(p.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-sm">{formatCurrency(p.baseSalary)}</td>
                  <td className="px-4 py-3 font-body text-xs">
                    <span className="text-white">{p.daysPresent}P</span>
                    <span className="text-[#666]"> / </span>
                    <span className="text-[#D62B2B]">{p.daysAbsent}A</span>
                    <span className="text-[#666]"> / {totalDays}d</span>
                    {isProRated && <span className="text-[#FFA726] ml-1">(pro-rated)</span>}
                  </td>
                  <td className="px-4 py-3 text-[#D62B2B] font-body text-sm">{p.deductions > 0 ? `-${formatCurrency(p.deductions)}` : '—'}</td>
                  <td className="px-4 py-3 text-[#4CAF50] font-body text-sm">{p.bonuses > 0 ? `+${formatCurrency(p.bonuses)}` : '—'}</td>
                  <td className="px-4 py-3 text-white font-body font-medium text-sm">
                    {formatCurrency(p.netPayable)}
                    {isProRated && <span className="block text-[#666] text-[10px] font-normal">of {formatCurrency(p.baseSalary)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 items-center">
                      <button onClick={() => setLedgerPayroll(p)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">View</button>
                      {p.status === 'DRAFT' && (
                        <>
                          <button onClick={() => approveMutation.mutate(p.id)} disabled={approveMutation.isPending} className="text-[#29B6F6] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">Approve</button>
                          <button onClick={() => { if (confirm(`Delete this draft payroll for ${p.staff?.name}?`)) deleteMutation.mutate(p.id); }} className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors">Delete</button>
                        </>
                      )}
                      {(p.status === 'APPROVED' || (p.status === 'PAID' && p.paidAmount < p.netPayable)) && (
                        <button
                          onClick={() => {
                            setPayingPayroll(p);
                            const remaining = (Number(p.netPayable) - Number(p.paidAmount)) / 100;
                            setPayForm({ amount: remaining.toFixed(2), paymentMethod: 'CASH', reference: '', notes: '' });
                          }}
                          className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                        >
                          Pay
                        </button>
                      )}
                      {p.paidAmount > 0 && (
                        <span className="text-[#666] font-body text-[10px]">
                          Paid: {formatCurrency(p.paidAmount)}{p.paidAmount < p.netPayable ? ` / ${formatCurrency(p.netPayable)}` : ''}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {payrolls.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666] font-body text-sm">No payroll records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate Dialog */}
      {showGenDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowGenDialog(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-6">GENERATE PAYROLL</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Staff Member *</label>
                <select
                  value={genForm.staffId}
                  onChange={(e) => handleStaffChange(e.target.value)}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  <option value="">— Select Staff —</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Period Start *</label>
                  <input
                    type="date"
                    value={genForm.periodStart}
                    onChange={(e) => setGenForm((f) => ({ ...f, periodStart: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Period End *</label>
                  <input
                    type="date"
                    value={genForm.periodEnd}
                    onChange={(e) => setGenForm((f) => ({ ...f, periodEnd: e.target.value }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              </div>
              {(['baseSalary', 'deductions', 'bonuses'] as const).map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
                    {key === 'baseSalary' ? 'Base Salary (৳) *' : key === 'deductions' ? 'Deductions (৳)' : 'Bonuses (৳)'}
                  </label>
                  <input
                    type="number" min="0"
                    value={genForm[key] as number}
                    onChange={(e) => setGenForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={genForm.notes ?? ''}
                  onChange={(e) => setGenForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            {generateMutation.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(generateMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowGenDialog(false)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button
                onClick={() => generateMutation.mutate(genForm)}
                disabled={!genForm.staffId || !genForm.periodStart || !genForm.periodEnd || generateMutation.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Ledger Modal */}
      {ledgerPayroll && <PayrollLedger payroll={ledgerPayroll} onClose={() => setLedgerPayroll(null)} />}

      {/* Pay Dialog */}
      {payingPayroll && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setPayingPayroll(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl text-white tracking-widest mb-1">PAY SALARY</h2>
            <p className="text-[#999] font-body text-sm mb-4">
              {payingPayroll.staff?.name} — Net: {formatCurrency(payingPayroll.netPayable)}
              {Number(payingPayroll.paidAmount) > 0 && ` | Paid: ${formatCurrency(payingPayroll.paidAmount)} | Remaining: ${formatCurrency(Number(payingPayroll.netPayable) - Number(payingPayroll.paidAmount))}`}
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Amount (৳) *</label>
                  <input type="number" step="0.01" min="0" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Method</label>
                  <select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                    {paymentOptions.map((o) => <option key={o.code} value={o.code}>{o.name}{o.category ? ` (${o.category.name})` : ''}</option>)}
                    {paymentOptions.length === 0 && <><option value="CASH">Cash</option><option value="CARD">Card</option></>}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Reference</label>
                <input value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Transaction ID, etc." className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
            </div>

            {/* Payment History */}
            {payingPayroll.payments && payingPayroll.payments.length > 0 && (
              <div className="mt-4 border-t border-[#2A2A2A] pt-3">
                <p className="text-[#666] text-xs font-body tracking-widest uppercase mb-2">Payment History</p>
                {payingPayroll.payments.map((pay) => (
                  <div key={pay.id} className="flex justify-between text-xs font-body py-1 border-b border-[#1F1F1F] last:border-0">
                    <span className="text-[#999]">{new Date(pay.createdAt).toLocaleDateString()} — {pay.paymentMethod}{pay.paidBy ? ` by ${pay.paidBy.name}` : ''}</span>
                    <span className="text-[#4CAF50]">{formatCurrency(pay.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {payMutation.error && <p className="text-[#F03535] text-xs font-body mt-3">{(payMutation.error as Error).message}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setPayingPayroll(null)} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5 transition-colors">Cancel</button>
              <button onClick={() => payMutation.mutate()} disabled={!payForm.amount || parseFloat(payForm.amount) <= 0 || payMutation.isPending} className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 transition-colors disabled:opacity-50">
                {payMutation.isPending ? 'Processing…' : 'Make Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
