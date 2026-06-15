import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { Payroll } from '@restora/types';
import { STATUS_COLORS } from '../components/payroll/payroll-status';
import { PayrollLedger } from '../components/payroll/PayrollLedger';
import { GeneratePayrollDialog } from '../components/payroll/GeneratePayrollDialog';
import { PayDialog } from '../components/payroll/PayDialog';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  isActive?: boolean;
}

const INVALIDATE_LIST = [['payroll-staff-summary'], ['payrolls', 'staff']] as const;

export default function PayrollStaffDetailPage() {
  const qc = useQueryClient();
  const { staffId } = useParams<{ staffId: string }>();

  const { data: staff } = useQuery<StaffMember>({
    queryKey: ['staff', staffId],
    queryFn: () => api.get(`/staff/${staffId}`),
    enabled: !!staffId,
  });

  const { data: payrolls = [], isLoading } = useQuery<Payroll[]>({
    queryKey: ['payrolls', 'staff', staffId],
    queryFn: () => api.get(`/payroll/staff/${staffId}`),
    enabled: !!staffId,
  });

  const [ledgerPayroll, setLedgerPayroll] = useState<Payroll | null>(null);
  const [payingPayroll, setPayingPayroll] = useState<Payroll | null>(null);
  const [showGenDialog, setShowGenDialog] = useState(false);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['payroll-staff-summary'] });
    void qc.invalidateQueries({ queryKey: ['payrolls', 'staff'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/${id}/approve`, {}),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/${id}`),
    onSuccess: invalidateAll,
  });

  const stats = useMemo(() => {
    let balanceOwed = 0;
    let totalPaid = 0;
    let draftCount = 0;
    for (const p of payrolls) {
      const net = Number(p.netPayable);
      const paid = Number(p.paidAmount);
      totalPaid += paid;
      if (p.status === 'APPROVED') balanceOwed += Math.max(0, net - paid);
      if (p.status === 'DRAFT') draftCount += 1;
    }
    return { balanceOwed, totalPaid, draftCount, count: payrolls.length };
  }, [payrolls]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3">
          <Link
            to="/payroll"
            className="text-[#999] hover:text-white mt-1 transition-colors"
            title="Back to payroll list"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl text-white tracking-widest">
              {staff?.name ?? 'PAYROLL'}
            </h1>
            <p className="text-[#666] font-body text-xs tracking-widest uppercase mt-0.5">
              {staff?.role ?? '—'}
              {staff && staff.isActive === false && <span className="text-[#FFA726] ml-2">INACTIVE</span>}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowGenDialog(true)}
          className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors"
        >
          + GENERATE PAYROLL
        </button>
      </div>

      {/* Chip strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Chip label="Balance Owed" value={stats.balanceOwed > 0 ? formatCurrency(stats.balanceOwed) : '—'} tone={stats.balanceOwed > 0 ? 'red' : 'muted'} />
        <Chip label="Total Paid" value={stats.totalPaid > 0 ? formatCurrency(stats.totalPaid) : '—'} tone={stats.totalPaid > 0 ? 'green' : 'muted'} />
        <Chip label="Payrolls" value={`${stats.count}`} tone="neutral" />
        <Chip label="Drafts" value={`${stats.draftCount}`} tone={stats.draftCount > 0 ? 'orange' : 'muted'} />
      </div>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading…</p>
      ) : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Period', 'Base Salary', 'Attendance', 'Deductions', 'Bonuses', 'Net Payable', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payrolls.map((p) => {
                const totalDays =
                  Math.round((new Date(p.periodEnd).getTime() - new Date(p.periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
                const isProRated = p.daysPresent > 0 && p.daysPresent < totalDays;
                return (
                  <tr key={p.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
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
                        <button
                          onClick={() => setLedgerPayroll(p)}
                          className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                        >
                          View
                        </button>
                        {p.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => approveMutation.mutate(p.id)}
                              disabled={approveMutation.isPending}
                              className="text-[#29B6F6] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete this draft payroll for ${p.staff?.name}?`)) deleteMutation.mutate(p.id);
                              }}
                              className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {(p.status === 'APPROVED' || (p.status === 'PAID' && p.paidAmount < p.netPayable)) && (
                          <button
                            onClick={() => setPayingPayroll(p)}
                            className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                          >
                            Pay
                          </button>
                        )}
                        {p.paidAmount > 0 && (
                          <span className="text-[#666] font-body text-[10px]">
                            Paid: {formatCurrency(p.paidAmount)}
                            {p.paidAmount < p.netPayable ? ` / ${formatCurrency(p.netPayable)}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {payrolls.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#666] font-body text-sm">
                    No payroll records yet for this staff. Click <strong>+ GENERATE PAYROLL</strong> to create the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {ledgerPayroll && <PayrollLedger payroll={ledgerPayroll} onClose={() => setLedgerPayroll(null)} />}
      <PayDialog payroll={payingPayroll} onClose={() => setPayingPayroll(null)} invalidateKeys={INVALIDATE_LIST} />
      <GeneratePayrollDialog
        open={showGenDialog}
        onClose={() => setShowGenDialog(false)}
        lockedStaffId={staffId}
        invalidateKeys={INVALIDATE_LIST}
      />

    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'red' | 'green' | 'orange' | 'neutral' | 'muted';
}) {
  const valueColor =
    tone === 'red' ? 'text-[#F03535]' :
    tone === 'green' ? 'text-[#4CAF50]' :
    tone === 'orange' ? 'text-[#FFA726]' :
    tone === 'muted' ? 'text-[#555]' :
    'text-white';
  return (
    <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
      <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">{label}</p>
      <p className={`font-display text-2xl tracking-wide ${valueColor}`}>{value}</p>
    </div>
  );
}
