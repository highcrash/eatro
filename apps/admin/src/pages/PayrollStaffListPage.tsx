import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { PayrollStaffSummaryRow } from '@restora/types';
import { STATUS_COLORS } from '../components/payroll/payroll-status';
import { GeneratePayrollDialog } from '../components/payroll/GeneratePayrollDialog';

const INVALIDATE_LIST = [['payroll-staff-summary'], ['payrolls', 'staff']] as const;

const formatPeriod = (startIso: string, endIso: string) => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
};

const formatDate = (iso: string | null) => {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function PayrollStaffListPage() {
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [genFocusStaffId, setGenFocusStaffId] = useState<string | undefined>(undefined);

  const { data: rows = [], isLoading } = useQuery<PayrollStaffSummaryRow[]>({
    queryKey: ['payroll-staff-summary', { includeInactive }],
    queryFn: () => api.get(`/payroll/staff-summary${includeInactive ? '?includeInactive=true' : ''}`),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.staff.name.toLowerCase().includes(q) || r.staff.role.toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    let balanceOwed = 0;
    let totalPaid = 0;
    let draftCount = 0;
    for (const r of rows) {
      balanceOwed += r.balanceOwed;
      totalPaid += r.totalPaid;
      draftCount += r.draftCount;
    }
    return { balanceOwed, totalPaid, draftCount };
  }, [rows]);

  const openGenFor = (staffId?: string) => {
    setGenFocusStaffId(staffId);
    setShowGenDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="font-display text-3xl text-white tracking-widest">PAYROLL</h1>
        <button
          onClick={() => openGenFor(undefined)}
          className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors"
        >
          + GENERATE PAYROLL
        </button>
      </div>

      {/* Top totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">Total Owed</p>
          <p className={`font-display text-2xl tracking-wide ${totals.balanceOwed > 0 ? 'text-[#F03535]' : 'text-[#555]'}`}>
            {totals.balanceOwed > 0 ? formatCurrency(totals.balanceOwed) : '—'}
          </p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">Total Paid (lifetime)</p>
          <p className={`font-display text-2xl tracking-wide ${totals.totalPaid > 0 ? 'text-[#4CAF50]' : 'text-[#555]'}`}>
            {totals.totalPaid > 0 ? formatCurrency(totals.totalPaid) : '—'}
          </p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-1">Pending Drafts</p>
          <p className={`font-display text-2xl tracking-wide ${totals.draftCount > 0 ? 'text-[#FFA726]' : 'text-[#555]'}`}>
            {totals.draftCount}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white pl-9 pr-3 py-2 text-sm font-body w-64 focus:outline-none focus:border-[#D62B2B] transition-colors"
          />
        </div>
        <label className="flex items-center gap-2 text-[#999] font-body text-xs tracking-widest uppercase cursor-pointer">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="accent-[#D62B2B]"
          />
          Show inactive staff
        </label>
      </div>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading…</p>
      ) : (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {['Staff', 'Latest Payroll', 'Status', 'Balance Owed', 'Total Paid', 'Last Paid', 'Payrolls', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const noPayrollYet = row.payrollCount === 0;
                return (
                  <tr
                    key={row.staffId}
                    className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F] cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        <div className="text-white font-body text-sm">
                          {row.staff.name}
                          {!row.staff.isActive && <span className="ml-2 text-[#FFA726] text-[10px] tracking-widest uppercase">Inactive</span>}
                        </div>
                        <div className="text-[#666] font-body text-[10px] tracking-widest uppercase mt-0.5">{row.staff.role}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        {row.latestPayroll ? formatPeriod(row.latestPayroll.periodStart, row.latestPayroll.periodEnd) : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        {row.latestPayroll ? (
                          <span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[row.latestPayroll.status]}`}>
                            {row.latestPayroll.status}
                          </span>
                        ) : (
                          <span className="text-[#555] font-body text-xs">—</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        {row.balanceOwed > 0 ? (
                          <span className="text-[#F03535] font-medium">{formatCurrency(row.balanceOwed)}</span>
                        ) : (
                          <span className="text-[#555]">—</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        {row.totalPaid > 0 ? <span className="text-[#4CAF50]">{formatCurrency(row.totalPaid)}</span> : <span className="text-[#555]">—</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#999] font-body text-xs">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        {formatDate(row.lastPaidAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-body text-xs">
                      <Link to={`/payroll/staff/${row.staffId}`} className="block">
                        <span className="text-white">{row.payrollCount}</span>
                        {row.draftCount > 0 && (
                          <span className="text-[#FFA726] ml-2 text-[10px] tracking-widest uppercase">
                            {row.draftCount} draft
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {noPayrollYet ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openGenFor(row.staffId);
                          }}
                          className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                        >
                          + First Payroll
                        </button>
                      ) : (
                        <Link to={`/payroll/staff/${row.staffId}`} className="inline-flex items-center text-[#999] hover:text-white">
                          <ChevronRight size={16} />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#666] font-body text-sm">
                    {rows.length === 0 ? 'No active staff yet.' : 'No staff matches that search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <GeneratePayrollDialog
        open={showGenDialog}
        onClose={() => {
          setShowGenDialog(false);
          setGenFocusStaffId(undefined);
        }}
        lockedStaffId={genFocusStaffId}
        invalidateKeys={INVALIDATE_LIST}
      />
    </div>
  );
}
