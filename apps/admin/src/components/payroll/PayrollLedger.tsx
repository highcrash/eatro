import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Payroll } from '@restora/types';
import { STATUS_COLORS } from './payroll-status';

export function PayrollLedger({ payroll, onClose }: { payroll: Payroll; onClose: () => void }) {
  const { data: payments = [] } = useQuery<
    { id: string; amount: number; paymentMethod: string; reference: string | null; notes: string | null; createdAt: string; paidBy?: { name: string } }[]
  >({
    queryKey: ['payroll-payments', payroll.id],
    queryFn: () => api.get(`/payroll/${payroll.id}/payments`),
  });

  const totalDays =
    Math.round((new Date(payroll.periodEnd).getTime() - new Date(payroll.periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const baseSalary = Number(payroll.baseSalary);
  const deductions = Number(payroll.deductions);
  const bonuses = Number(payroll.bonuses);
  const netPayable = Number(payroll.netPayable);
  const paidAmount = Number(payroll.paidAmount);
  const remaining = netPayable - paidAmount;

  const handlePrint = () => {
    const paymentRows = payments
      .map(
        (p, i) => `<tr>
      <td>${i + 1}</td>
      <td>${new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${p.paymentMethod}</td>
      <td>${p.reference || '—'}</td>
      <td>${p.paidBy?.name || '—'}</td>
      <td>${p.notes || '—'}</td>
      <td class="r">${formatCurrency(Number(p.amount))}</td>
    </tr>`,
      )
      .join('');

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

      ${
        payments.length > 0
          ? `
        <h2>PAYMENT HISTORY</h2>
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th>Paid By</th><th>Notes</th><th class="r">Amount</th></tr></thead>
          <tbody>
            ${paymentRows}
            <tr class="total"><td colspan="6">Total Paid</td><td class="r">${formatCurrency(paidAmount)}</td></tr>
            ${remaining > 0 ? `<tr><td colspan="6" style="color:#c62828">Remaining</td><td class="r" style="color:#c62828">${formatCurrency(remaining)}</td></tr>` : ''}
          </tbody>
        </table>
      `
          : '<p style="color:#666;margin-top:16px">No payments recorded yet.</p>'
      }

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
        <div className="sticky top-0 bg-[#161616] px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between z-10">
          <div>
            <h3 className="font-display text-2xl text-white tracking-wide">PAYROLL LEDGER</h3>
            <p className="text-xs font-body text-[#666] mt-0.5">
              {payroll.staff?.name} — {payroll.staff?.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="text-[#999] hover:text-white p-1.5" title="Print">
              <Printer size={16} />
            </button>
            <button onClick={onClose} className="text-[#999] hover:text-white p-1.5">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[payroll.status]}`}>{payroll.status}</span>
            <span className="text-xs font-body text-[#666]">
              {new Date(payroll.periodStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} —{' '}
              {new Date(payroll.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>

          <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4 space-y-2">
            <div className="flex justify-between text-sm font-body">
              <span className="text-[#666]">Base Salary</span>
              <span className="text-white">{formatCurrency(baseSalary)}</span>
            </div>
            <div className="flex justify-between text-sm font-body">
              <span className="text-[#666]">Attendance</span>
              <span>
                <span className="text-white">{payroll.daysPresent}P</span> / <span className="text-[#D62B2B]">{payroll.daysAbsent}A</span> /{' '}
                <span className="text-[#666]">{totalDays}d</span>
              </span>
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

          {payroll.notes && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3">
              <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">Notes</p>
              <p className="text-sm font-body text-[#999] whitespace-pre-wrap">{payroll.notes}</p>
            </div>
          )}

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
                      <td colSpan={5} className="px-3 py-2 text-xs font-medium text-white tracking-widest uppercase">
                        Total Paid
                      </td>
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
