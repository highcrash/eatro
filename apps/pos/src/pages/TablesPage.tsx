import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { User, Tag, Eye, X, Check, Settings2 } from 'lucide-react';

import type { DiningTable, Order, TableStatus } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';

const STATUS_CARD: Record<string, string> = {
  AVAILABLE: 'border-theme-border bg-theme-surface hover:border-theme-accent',
  OCCUPIED:  'border-theme-accent bg-theme-surface',
  RESERVED:  'border-theme-info bg-theme-surface',
  CLEANING:  'border-theme-border bg-theme-surface-alt opacity-70',
};

const STATUS_BAR: Record<string, string> = {
  AVAILABLE: 'bg-theme-pop',
  OCCUPIED:  'bg-theme-accent',
  RESERVED:  'bg-theme-info',
  CLEANING:  'bg-theme-text-muted',
};

function ChairIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2">
      <path d="M6 4v8h12V4M6 12v6M18 12v6M4 12h16" strokeLinecap="round" />
    </svg>
  );
}

interface PosAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  isActive: boolean;
  showInPOS: boolean;
  linkedPaymentMethod: string | null;
}

interface WorkPeriodSummary {
  workPeriod: { id: string; startedAt: string; endedAt: string | null };
  totalSales: number;
  orderCount: number;
  voidedOrders: number;
  byPaymentMethod: Record<string, number>;
  byOrderType: Record<string, { count: number; total: number }>;
  totalExpenses: number;
  expenseCount: number;
  expenseByCategory: Record<string, number>;
  taxBreakdown?: {
    subtotal: number;
    discountTotal: number;
    serviceChargeTotal: number;
    vatTotal: number;
    netSales: number;
  };
  balances: {
    opening: Record<string, number>;
    salesByMethod: Record<string, number>;
    expensesByMethod: Record<string, number>;
    supplierPaymentsByMethod: Record<string, number>;
    salaryPaymentsByMethod: Record<string, number>;
    expected: Record<string, number>;
    closing: Record<string, number | null>;
    discrepancy: Record<string, number>;
    openingByAccount: Record<string, number>;
    salesByAccount: Record<string, number>;
    expensesByAccount: Record<string, number>;
    supplierByAccount: Record<string, number>;
    salaryByAccount: Record<string, number>;
    expectedByAccount: Record<string, number>;
    closingByAccount: Record<string, number | null>;
    discrepancyByAccount: Record<string, number>;
  };
  posAccounts: Array<{ id: string; name: string; type: string; linkedPaymentMethod: string | null }>;
  consumedItems: Array<{ id: string; name: string; unit: string; quantity: number; value: number }>;
  consumedTotalValue: number;
  wasteItems: Array<{ id: string; name: string; unit: string; quantity: number; value: number }>;
  wasteTotalValue: number;
}

interface LastClosing {
  closingBalances: Record<string, number>;
  closingCash: number;
  closingMFS: number;
  closingCard: number;
  endedAt: string;
}

function printEndOfDayReport(summary: WorkPeriodSummary) {
  const { workPeriod: wp, totalSales, orderCount, voidedOrders, byPaymentMethod, byOrderType, totalExpenses, expenseCount, expenseByCategory, taxBreakdown, balances, posAccounts, consumedItems, consumedTotalValue, wasteItems, wasteTotalValue } = summary;

  const startTime = new Date(wp.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const endTime = wp.endedAt ? new Date(wp.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Now';

  const paymentRows = Object.entries(byPaymentMethod)
    .map(([method, amount]) => `<tr><td style="padding:2px 0">${method}</td><td style="text-align:right">${formatCurrency(amount)}</td></tr>`)
    .join('');

  const orderTypeRows = Object.entries(byOrderType)
    .map(([type, data]) => `<tr><td style="padding:2px 0">${type.replace('_', ' ')}</td><td style="text-align:center">${data.count}</td><td style="text-align:right">${formatCurrency(data.total)}</td></tr>`)
    .join('');

  const expenseRows = Object.entries(expenseByCategory)
    .map(([cat, amount]) => `<tr><td style="padding:2px 0">${cat.replace('_', ' ')}</td><td style="text-align:right">${formatCurrency(amount)}</td></tr>`)
    .join('');

  const netCash = totalSales - totalExpenses;

  // Balance reconciliation table — dynamic per account
  const b = balances;
  const accounts = posAccounts ?? [];

  const reconRows = accounts.map((acc) => {
    const opening = b.openingByAccount?.[acc.id] ?? 0;
    const sales = b.salesByAccount?.[acc.id] ?? 0;
    const exp = b.expensesByAccount?.[acc.id] ?? 0;
    const sup = b.supplierByAccount?.[acc.id] ?? 0;
    const sal = b.salaryByAccount?.[acc.id] ?? 0;
    const expected = b.expectedByAccount?.[acc.id] ?? 0;
    const actual = b.closingByAccount?.[acc.id];
    const diff = actual != null ? expected - actual : 0;
    const diffStyle = diff !== 0 ? 'color:#D62B2B;font-weight:bold' : '';
    return `<tr>
      <td style="padding:2px 4px">${acc.name}</td>
      <td style="text-align:right;padding:2px 4px">${formatCurrency(opening)}</td>
      <td style="text-align:right;padding:2px 4px">${formatCurrency(sales)}</td>
      <td style="text-align:right;padding:2px 4px">${formatCurrency(exp)}</td>
      <td style="text-align:right;padding:2px 4px">${formatCurrency(sup)}</td>
      <td style="text-align:right;padding:2px 4px">${formatCurrency(sal)}</td>
      <td style="text-align:right;padding:2px 4px;font-weight:bold">${formatCurrency(expected)}</td>
      <td style="text-align:right;padding:2px 4px">${actual != null ? formatCurrency(actual) : '-'}</td>
      <td style="text-align:right;padding:2px 4px;${diffStyle}">${actual != null ? formatCurrency(diff) : '-'}</td>
    </tr>`;
  }).join('');

  const html = `<html><head><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; width: 80mm; padding: 8px; font-size: 12px; color: #000; }
    h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
    h2 { font-size: 13px; margin: 10px 0 4px; border-bottom: 1px dashed #000; padding-bottom: 2px; }
    .meta { font-size: 11px; text-align: center; color: #666; margin-bottom: 2px; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .bold-divider { border-top: 2px solid #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .recon-table { font-size: 9px; }
    .recon-table th { font-size: 8px; text-align: right; padding: 2px 4px; border-bottom: 1px solid #000; }
    .recon-table th:first-child { text-align: left; }
    .total-row td { font-weight: bold; font-size: 14px; padding-top: 4px; }
    .big-total { font-size: 18px; font-weight: bold; text-align: center; margin: 8px 0; }
  </style></head><body>
    <h1>END OF DAY REPORT</h1>
    <div class="meta">${startTime} — ${endTime}</div>
    <div class="divider"></div>

    <h2>SALES SUMMARY</h2>
    <table>
      <tr><td>Total Orders</td><td style="text-align:right">${orderCount}</td></tr>
      <tr><td>Voided Orders</td><td style="text-align:right">${voidedOrders}</td></tr>
    </table>
    <div class="big-total">${formatCurrency(totalSales)}</div>

    <h2>BY PAYMENT METHOD</h2>
    <table>${paymentRows || '<tr><td colspan="2" style="text-align:center;color:#999">No sales</td></tr>'}</table>

    <h2>BY ORDER TYPE</h2>
    <table>
      <tr style="font-size:10px;color:#666"><td>Type</td><td style="text-align:center">Qty</td><td style="text-align:right">Amount</td></tr>
      ${orderTypeRows || '<tr><td colspan="3" style="text-align:center;color:#999">No sales</td></tr>'}
    </table>

    ${taxBreakdown ? `
    <div class="divider"></div>
    <h2>TAX BREAKDOWN (PAID ORDERS)</h2>
    <table>
      <tr><td>Gross Subtotal</td><td style="text-align:right">${formatCurrency(taxBreakdown.subtotal)}</td></tr>
      ${taxBreakdown.discountTotal > 0 ? `<tr><td>− Discounts</td><td style="text-align:right">-${formatCurrency(taxBreakdown.discountTotal)}</td></tr>` : ''}
      ${taxBreakdown.serviceChargeTotal > 0 ? `<tr><td>+ Service Charge</td><td style="text-align:right">${formatCurrency(taxBreakdown.serviceChargeTotal)}</td></tr>` : ''}
      ${taxBreakdown.vatTotal > 0 ? `<tr><td>+ VAT</td><td style="text-align:right">${formatCurrency(taxBreakdown.vatTotal)}</td></tr>` : ''}
      <tr class="total-row"><td>Net Sales</td><td style="text-align:right">${formatCurrency(taxBreakdown.netSales)}</td></tr>
    </table>
    ` : ''}

    <div class="divider"></div>
    <h2>EXPENSES (${expenseCount})</h2>
    <table>${expenseRows || '<tr><td colspan="2" style="text-align:center;color:#999">No expenses</td></tr>'}</table>
    <table><tr class="total-row"><td>Total Expenses</td><td style="text-align:right">${formatCurrency(totalExpenses)}</td></tr></table>

    <div class="bold-divider"></div>
    <table>
      <tr class="total-row"><td>NET (Sales - Expenses)</td><td style="text-align:right">${formatCurrency(netCash)}</td></tr>
    </table>

    <div class="bold-divider"></div>
    <h2>BALANCE RECONCILIATION</h2>
    <table class="recon-table">
      <tr>
        <th style="text-align:left">Account</th>
        <th>Opening</th>
        <th>+Sales</th>
        <th>-Expense</th>
        <th>-Supplier</th>
        <th>-Salary</th>
        <th>=Expected</th>
        <th>Actual</th>
        <th>Diff</th>
      </tr>
      ${reconRows}
    </table>

    ${consumedItems && consumedItems.length > 0 ? `
    <div class="divider"></div>
    <h2>CONSUMED INGREDIENTS</h2>
    <table>
      ${consumedItems.map((it) => `<tr><td style="padding:2px 0">${it.name}</td><td style="text-align:right">${it.quantity.toFixed(3)} ${it.unit}</td><td style="text-align:right">${formatCurrency(it.value)}</td></tr>`).join('')}
      <tr class="total-row"><td>TOTAL CONSUMED</td><td></td><td style="text-align:right">${formatCurrency(consumedTotalValue ?? 0)}</td></tr>
    </table>` : ''}

    ${wasteItems && wasteItems.length > 0 ? `
    <div class="divider"></div>
    <h2>WASTED ITEMS</h2>
    <table>
      ${wasteItems.map((it) => `<tr><td style="padding:2px 0">${it.name}</td><td style="text-align:right">${it.quantity.toFixed(3)} ${it.unit}</td><td style="text-align:right">${formatCurrency(it.value)}</td></tr>`).join('')}
      <tr class="total-row"><td>TOTAL WASTE</td><td></td><td style="text-align:right">${formatCurrency(wasteTotalValue ?? 0)}</td></tr>
    </table>` : ''}

    <div class="divider"></div>
    <div class="meta" style="margin-top:8px">*** End of Day ***</div>

    <script>window.onload=function(){window.print();window.close();}<\/script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=320,height=700');
  if (win) { win.document.write(html); win.document.close(); }
}

export default function TablesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [showEndDay, setShowEndDay] = useState(false);
  const [showStartDay, setShowStartDay] = useState(false);
  const [openingBalances, setOpeningBalances] = useState<Record<string, string>>({});
  const [closingBalances, setClosingBalances] = useState<Record<string, string>>({});
  const [endDaySummary, setEndDaySummary] = useState<WorkPeriodSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const canManageDay = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'CASHIER';
  const [statusFilter, setStatusFilter] = useState<'ALL' | TableStatus>('ALL');
  const [tableSearch, setTableSearch] = useState('');
  const [startPassword, setStartPassword] = useState('');
  const [endPassword, setEndPassword] = useState('');
  const [pwError, setPwError] = useState('');

  // ─── Table options state (Feature 2 & 3) ──────────────────────────────────
  const [contextTable, setContextTable] = useState<DiningTable | null>(null);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showWaiterSelect, setShowWaiterSelect] = useState(false);
  const [showStatusChange, setShowStatusChange] = useState(false);

  const { data: tables = [], isLoading } = useQuery<DiningTable[]>({
    queryKey: ['tables'],
    queryFn: () => api.get<DiningTable[]>('/tables'),
  });

  const { data: posAccounts = [] } = useQuery<PosAccount[]>({
    queryKey: ['pos-accounts'],
    queryFn: () => api.get<PosAccount[]>('/accounts'),
    select: (data) => data.filter((a) => a.showInPOS && a.isActive),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const { data: workPeriod } = useQuery<{ id: string; startedAt: string; startedBy: { name: string } } | null>({
    queryKey: ['work-period-current'],
    queryFn: () => api.get('/work-periods/current'),
    staleTime: 0,
    refetchInterval: 5000,
    refetchOnMount: 'always',
  });

  const { data: lastClosing } = useQuery<LastClosing | null>({
    queryKey: ['work-period-last-closing'],
    queryFn: () => api.get('/work-periods/last-closing'),
    enabled: !workPeriod,
  });

  // ─── Feature 1: Poll pending QR orders ──────────────────────────────────────
  const { data: pendingOrders = [] } = useQuery<Order[]>({
    queryKey: ['pending-orders'],
    queryFn: () => api.get<Order[]>('/orders?status=PENDING'),
    refetchInterval: 3000,
  });

  const pendingTableIds = new Set(
    pendingOrders.filter((o) => o.tableId).map((o) => o.tableId!),
  );

  // Poll active orders for PENDING_APPROVAL items and bill requests
  const { data: activeOrders = [] } = useQuery<Order[]>({
    queryKey: ['active-orders-approval'],
    queryFn: () => api.get<Order[]>('/orders?status=CONFIRMED,PREPARING,READY,SERVED'),
    refetchInterval: 3000,
  });

  const pendingApprovalTableIds = new Set(
    activeOrders
      .filter((o) => o.tableId && o.items?.some((i) => i.kitchenStatus === 'PENDING_APPROVAL' && !i.voidedAt))
      .map((o) => o.tableId!),
  );

  const billRequestedTableIds = new Set(
    activeOrders
      .filter((o) => o.tableId && (o as any).billRequested)
      .map((o) => o.tableId!),
  );

  // Active takeaway / pending takeaway orders (no tableId)
  const takeawayOrders = useMemo(
    () => [...pendingOrders, ...activeOrders].filter((o) => !o.tableId && o.type === 'TAKEAWAY'),
    [pendingOrders, activeOrders],
  );

  // ─── Feature 2: Waiter list ──────────────────────────────────────────────────
  const { data: waiters = [] } = useQuery<{ id: string; name: string; role: string; isActive: boolean }[]>({
    queryKey: ['waiters'],
    queryFn: () => api.get('/staff'),
    select: (d) => d.filter((s: { role: string; isActive: boolean }) => s.isActive && s.role !== 'KITCHEN'),
  });

  // ─── Feature 3: Change table status ──────────────────────────────────────────
  const changeStatusMut = useMutation({
    mutationFn: ({ tableId, status }: { tableId: string; status: TableStatus }) =>
      api.patch(`/tables/${tableId}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tables'] });
      setShowStatusChange(false);
      setShowTableMenu(false);
      setContextTable(null);
    },
  });

  // Assign waiter to the active order on a table
  const assignWaiterMut = useMutation({
    mutationFn: async ({ tableId, waiterId }: { tableId: string; waiterId: string }) => {
      // Find the active order for this table
      const orders = await api.get<Order[]>(`/orders?tableId=${tableId}`);
      if (orders.length > 0) {
        return api.patch(`/orders/${orders[0].id}/waiter`, { waiterId });
      }
      throw new Error('No active order on this table');
    },
    onSuccess: () => {
      setShowWaiterSelect(false);
      setShowTableMenu(false);
      setContextTable(null);
    },
  });

  // Always lock opening balances to the current account balances in the system.
  useEffect(() => {
    if (showStartDay) {
      // Force a fresh fetch so we don't display a stale snapshot.
      void qc.invalidateQueries({ queryKey: ['pos-accounts'] });
    }
  }, [showStartDay, qc]);

  useEffect(() => {
    if (showStartDay) {
      const prefilled: Record<string, string> = {};
      for (const acc of posAccounts) {
        prefilled[acc.id] = (Number(acc.balance) / 100).toFixed(2);
      }
      setOpeningBalances(prefilled);
    }
  }, [showStartDay, posAccounts]);

  const startDayMut = useMutation({
    mutationFn: (dto: { notes: string; openingBalances: Record<string, number> }) =>
      api.post('/work-periods/start', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-period-current'] });
      setShowStartDay(false);
      setStartPassword('');
      setPwError('');
    },
  });

  const endDayMut = useMutation({
    mutationFn: async (dto: { closingBalances: Record<string, number> }) => {
      await api.post('/work-periods/end', dto);
    },
    onSuccess: async () => {
      // 1. Flip the UI immediately by writing null into the cache.
      qc.setQueryData(['work-period-current'], null);
      // 2. Close the modal right away so the cashier sees the updated state.
      setShowEndDay(false);
      setEndPassword('');
      setPwError('');

      // 3. Try to fetch summary + print, but never let print errors block the UI flip.
      const wpId = workPeriod?.id;
      if (wpId) {
        try {
          const summary = await api.get<WorkPeriodSummary>(`/work-periods/${wpId}/summary`);
          try {
            printEndOfDayReport(summary);
          } catch (e) {
            console.warn('Print failed:', e);
          }
        } catch (e) {
          console.warn('Failed to fetch end-day summary:', e);
        }
      }

      // 4. Refresh related caches to confirm.
      void qc.invalidateQueries({ queryKey: ['work-period-current'] });
      void qc.invalidateQueries({ queryKey: ['work-period-last-closing'] });
      setEndDaySummary(null);
    },
  });

  // Fetch summary when End Day modal opens
  const openEndDayModal = async () => {
    if (!workPeriod) return;
    setShowEndDay(true);
    setLoadingSummary(true);
    await qc.invalidateQueries({ queryKey: ['pos-accounts'] });
    try {
      const summary = await api.get<WorkPeriodSummary>(`/work-periods/${workPeriod.id}/summary`);
      setEndDaySummary(summary);
      // Start the cashier with empty inputs — they must count and enter actuals.
      setClosingBalances({});
    } catch {
      // If summary fails, still show the modal
    } finally {
      setLoadingSummary(false);
    }
  };

  // Compute discrepancy: positive = SHORT (cashier counted less), negative = OVER
  const calcDiff = (expected: number, actualStr: string) => {
    if (!actualStr.trim()) return null;
    const actual = Math.round(parseFloat(actualStr || '0') * 100);
    return expected - actual;
  };

  const handleOpenStartDay = () => {
    setShowStartDay(true);
    if (!lastClosing) setOpeningBalances({});
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-theme-border font-theme-body text-sm">Loading tables...</span>
      </div>
    );
  }

  const filteredTables = tables.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (tableSearch.trim() && !t.tableNumber.toLowerCase().includes(tableSearch.trim().toLowerCase())) return false;
    return true;
  });

  const STATUS_TABS: { key: 'ALL' | TableStatus; label: string }[] = [
    { key: 'ALL',       label: 'All Tables' },
    { key: 'AVAILABLE', label: 'Vacant' },
    { key: 'OCCUPIED',  label: 'Occupied' },
    { key: 'RESERVED',  label: 'Reserved' },
    { key: 'CLEANING',  label: 'Cleaning' },
  ];

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Top bar */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-5 shrink-0">
        <h1 className="text-xl font-extrabold text-theme-text">Tables</h1>
        <div className="flex-1 max-w-md relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">🔍</span>
          <input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            className="w-full bg-theme-bg rounded-full pl-11 pr-4 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
            placeholder="Search table…"
          />
        </div>
        {workPeriod ? (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-theme bg-theme-pop-soft">
              <span className="w-2 h-2 rounded-full bg-theme-pop" />
              <span className="text-xs font-semibold text-theme-pop">
                Day open · {new Date(workPeriod.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {workPeriod.startedBy?.name}
              </span>
            </div>
            {canManageDay && (
              <button
                onClick={() => void openEndDayModal()}
                className="text-xs font-semibold text-theme-text-muted hover:text-theme-accent transition-colors"
              >
                End Day
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-theme bg-theme-bg">
              <span className="w-2 h-2 rounded-full bg-theme-text-muted" />
              <span className="text-xs font-semibold text-theme-text-muted">No active period</span>
            </div>
            {canManageDay && (
              <button
                onClick={handleOpenStartDay}
                className="bg-theme-accent hover:opacity-90 text-white text-xs font-bold px-4 py-2 rounded-theme transition-opacity"
              >
                Start Day
              </button>
            )}
          </>
        )}
        <button
          onClick={() => void navigate('/reports/sales')}
          className="text-xs font-semibold text-theme-text-muted hover:text-theme-accent transition-colors"
        >
          Reports
        </button>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6">
        {/* Filter pill tabs */}
        <div className="flex gap-1 bg-theme-surface rounded-theme p-1 shadow-sm w-fit mb-5 border border-theme-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-5 py-2 text-sm rounded-theme transition-colors ${
                statusFilter === tab.key
                  ? 'font-semibold text-theme-accent border-2 border-theme-accent'
                  : 'font-medium text-theme-text-muted hover:text-theme-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active Takeaway Orders */}
        {takeawayOrders.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">
              Active Takeaway ({takeawayOrders.length})
            </p>
            <div className="grid grid-cols-4 gap-3">
              {takeawayOrders.map((o) => {
                const isPending = o.status === 'PENDING';
                const billRequested = (o as any).billRequested;
                return (
                  <button
                    key={o.id}
                    onClick={() => void navigate(`/order?orderId=${o.id}`)}
                    className={`relative bg-theme-surface rounded-theme border-2 p-4 text-left transition-colors ${
                      isPending ? 'border-theme-warn hover:border-theme-warn' :
                      billRequested ? 'border-theme-info hover:border-theme-info' :
                      'border-theme-border hover:border-theme-accent'
                    }`}
                  >
                    {(isPending || billRequested) && (
                      <span className={`absolute top-2 right-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        isPending ? 'bg-theme-warn text-white' : 'bg-theme-info text-white'
                      }`}>
                        {isPending ? 'PENDING' : '💰 BILL'}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">🛍️</span>
                      <span className="text-[10px] font-bold uppercase text-theme-text-muted">Takeaway</span>
                    </div>
                    <p className="text-sm font-bold text-theme-text">#{o.orderNumber}</p>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                      {o.items?.filter((i) => !i.voidedAt).length ?? 0} items
                    </p>
                    <p className="text-base font-extrabold text-theme-text mt-1">
                      {formatCurrency(Number(o.totalAmount))}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">Tables</p>
        <div className="grid grid-cols-4 gap-5">
          {filteredTables.map((table) => {
            const hasPendingQR = pendingTableIds.has(table.id);
            const hasPendingApproval = pendingApprovalTableIds.has(table.id);
            const hasBillRequest = billRequestedTableIds.has(table.id);
            // Priority: QR ORDER > NEW ITEMS > BILL
            const badgeType = hasPendingQR ? 'qr' : hasPendingApproval ? 'items' : hasBillRequest ? 'bill' : null;
            return (
              <button
                key={table.id}
                onClick={() => {
                  if (!workPeriod) { handleOpenStartDay(); return; }
                  if (table.status === 'AVAILABLE' || table.status === 'OCCUPIED') {
                    void navigate(`/order/${table.id}`, { state: { tableNumber: table.tableNumber } });
                  }
                }}
                className={`relative border-2 rounded-theme overflow-hidden text-left transition-all cursor-pointer ${STATUS_CARD[table.status] ?? ''} ${hasPendingQR || hasPendingApproval || hasBillRequest ? 'ring-2 ring-theme-warn animate-pulse' : ''}`}
              >
                {badgeType && (
                  <div className={`absolute top-2 right-2 z-10 text-[9px] font-theme-body font-bold px-1.5 py-0.5 tracking-wider uppercase rounded-theme animate-bounce ${
                    badgeType === 'qr' ? 'bg-theme-warn text-theme-text' :
                    badgeType === 'items' ? 'bg-theme-accent text-white' :
                    'bg-theme-info text-white'
                  }`}>
                    {badgeType === 'qr' ? 'QR ORDER' : badgeType === 'items' ? 'NEW ITEMS' : '💰 BILL'}
                  </div>
                )}
                {/* Floating options button — easier touch target than the
                    old inline cog glyph. 40×40 px tap area, pinned to the
                    top-LEFT so the right-side QR/NEW-ITEMS/BILL badges don't
                    collide with it. */}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Options for table ${table.tableNumber}`}
                  onClick={(e) => { e.stopPropagation(); setContextTable(table); setShowTableMenu(true); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setContextTable(table); setShowTableMenu(true); } }}
                  title="Table options"
                  className="absolute top-2 left-2 z-10 w-10 h-10 flex items-center justify-center rounded-theme bg-theme-bg/80 backdrop-blur text-theme-text-muted hover:bg-theme-accent hover:text-white active:scale-95 transition-all border border-theme-border shadow-sm cursor-pointer"
                >
                  <Settings2 size={18} />
                </span>

                {/* Body */}
                <div className="p-5 flex flex-col items-center gap-2">
                  <div className="text-theme-accent">
                    <ChairIcon />
                  </div>
                  <div className="font-theme-display text-3xl text-theme-text tracking-wide">
                    {table.tableNumber}
                  </div>
                  <div className="text-[10px] font-theme-body text-theme-text-muted uppercase tracking-widest">
                    {table.capacity} seats
                  </div>
                </div>
                {/* Status bar */}
                <div className={`h-2 w-full ${STATUS_BAR[table.status] ?? 'bg-theme-border'}`} />
              </button>
            );
          })}

          {/* Takeaway card */}
          {(statusFilter === 'ALL' || statusFilter === 'AVAILABLE') && !tableSearch && (
            <button
              onClick={() => { if (!workPeriod) { handleOpenStartDay(); return; } void navigate('/order'); }}
              className="bg-theme-surface rounded-theme border-2 border-dashed border-theme-border p-6 flex flex-col items-center justify-center hover:border-theme-accent hover:bg-theme-surface-alt transition-all"
            >
              <span className="text-3xl mb-2">🛍️</span>
              <p className="text-base font-bold text-theme-text">Takeaway</p>
              <p className="text-[10px] text-theme-text-muted mt-1">No table</p>
            </button>
          )}
        </div>

        {filteredTables.length === 0 && (
          <p className="text-center text-sm text-theme-text-muted py-12">No tables match this filter</p>
        )}
      </div>

      {/* Bottom legend strip */}
      <footer className="bg-theme-surface border-t border-theme-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6 text-sm text-theme-text-muted">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-theme-pop" />Vacant</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-theme-accent" />Occupied</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-theme-warn" />QR Pending</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-theme-info" />Bill Requested</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-theme-text-muted" />Cleaning</div>
        </div>
        <div className="text-xs text-theme-text-muted font-semibold">{filteredTables.length} of {tables.length} tables</div>
      </footer>

      {/* Start Day Modal */}
      {showStartDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-[480px] overflow-hidden">
            <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-theme-text">Start Day · Opening Balances</h3>
              <button
                onClick={() => setShowStartDay(false)}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={14} />
              </button>
            </header>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-auto">
              <p className="text-xs text-theme-text-muted">
                Opening balances are locked to the current account balances in the system.
              </p>

              {posAccounts.length === 0 ? (
                <div className="bg-theme-danger/5 border border-theme-danger/30 rounded-theme p-3 text-xs text-theme-danger">
                  No POS accounts configured. Go to Settings &gt; Accounts and enable "Show in POS" for at least one account.
                </div>
              ) : (
                <div className="space-y-3">
                  {posAccounts.map((acc) => (
                    <div key={acc.id} className="border border-theme-border rounded-theme p-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-theme-text">{acc.name}</p>
                        <span className="text-[10px] text-theme-pop font-bold">SYSTEM BALANCE</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-theme-text-muted text-sm">৳</span>
                        <input
                          type="text"
                          readOnly
                          value={openingBalances[acc.id] ?? '0.00'}
                          className="flex-1 bg-theme-bg rounded-theme px-3 py-2 text-base font-bold text-theme-text outline-none border border-transparent cursor-not-allowed"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 pb-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                Confirm with your password
              </label>
              <input
                type="password"
                value={startPassword}
                onChange={(e) => { setStartPassword(e.target.value); setPwError(''); }}
                placeholder="Enter your POS password"
                className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              />
              {pwError && <p className="text-xs text-theme-danger mt-1.5">{pwError}</p>}
            </div>

            <footer className="px-6 py-4 border-t border-theme-border flex gap-3">
              <button
                onClick={() => { setShowStartDay(false); setStartPassword(''); setPwError(''); }}
                className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setPwError('');
                  if (!startPassword || !user?.email) { setPwError('Password required'); return; }
                  try {
                    await api.post('/auth/verify-self', { email: user.email, password: startPassword });
                  } catch {
                    setPwError('Incorrect password');
                    return;
                  }
                  startDayMut.mutate({
                    notes: posAccounts.map((a) => `${a.name}: ৳${openingBalances[a.id] || '0'}`).join(' | '),
                    openingBalances: Object.fromEntries(
                      posAccounts.map((a) => [a.id, Math.round(parseFloat(openingBalances[a.id] || '0') * 100)]),
                    ),
                  });
                }}
                disabled={startDayMut.isPending || posAccounts.length === 0 || !startPassword}
                className="flex-1 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
              >
                {startDayMut.isPending ? 'Starting…' : 'Confirm & Start Day'}
              </button>
            </footer>

            {startDayMut.isError && (
              <p className="px-6 pb-4 text-xs text-theme-danger text-center">{(startDayMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* Table Options Menu */}
      {showTableMenu && contextTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowTableMenu(false); setContextTable(null); }}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-[280px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-theme-border">
              <p className="text-xs font-bold text-theme-text">T{contextTable.tableNumber} — Options</p>
              <p className="text-[10px] text-theme-text-muted mt-0.5">
                {contextTable.status.toLowerCase()} · {contextTable.capacity} seats
              </p>
            </div>
            <button
              onClick={() => { setShowTableMenu(false); setShowWaiterSelect(true); }}
              className="w-full text-left px-4 py-2.5 text-sm font-medium text-theme-text hover:bg-theme-bg flex items-center gap-2 transition-colors"
            >
              <User size={14} className="text-theme-text-muted" /> Set Waiter
            </button>
            <button
              onClick={() => { setShowTableMenu(false); setShowStatusChange(true); }}
              className="w-full text-left px-4 py-2.5 text-sm font-medium text-theme-text hover:bg-theme-bg flex items-center gap-2 transition-colors"
            >
              <Tag size={14} className="text-theme-text-muted" /> Change Status
            </button>
            <button
              onClick={() => {
                setShowTableMenu(false);
                if (contextTable.status === 'OCCUPIED') {
                  void navigate(`/order/${contextTable.id}`, { state: { tableNumber: contextTable.tableNumber } });
                }
                setContextTable(null);
              }}
              disabled={contextTable.status !== 'OCCUPIED'}
              className="w-full text-left px-4 py-2.5 text-sm font-medium text-theme-text hover:bg-theme-bg flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eye size={14} className="text-theme-text-muted" /> View Order
            </button>
            <div className="border-t border-theme-border">
              <button
                onClick={() => { setShowTableMenu(false); setContextTable(null); }}
                className="w-full text-left px-4 py-2.5 text-sm text-theme-text-muted hover:bg-theme-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Waiter Modal */}
      {showWaiterSelect && contextTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowWaiterSelect(false); setContextTable(null); }}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-theme-text">Set Waiter</h3>
                <p className="text-xs text-theme-text-muted mt-0.5">Table T{contextTable.tableNumber}</p>
              </div>
              <button
                onClick={() => { setShowWaiterSelect(false); setContextTable(null); }}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={14} />
              </button>
            </header>
            <div className="overflow-auto p-3 space-y-1">
              {waiters.length === 0 ? (
                <p className="text-center text-sm text-theme-text-muted py-6">No active waiters found</p>
              ) : (
                waiters.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => assignWaiterMut.mutate({ tableId: contextTable.id, waiterId: w.id })}
                    disabled={assignWaiterMut.isPending}
                    className="w-full flex items-center gap-3 p-3 rounded-theme hover:bg-theme-bg text-left transition-colors disabled:opacity-40"
                  >
                    <div className="w-9 h-9 rounded-full bg-theme-accent-soft flex items-center justify-center text-theme-accent text-sm font-bold">
                      {w.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm font-semibold text-theme-text">{w.name}</span>
                  </button>
                ))
              )}
            </div>
            {assignWaiterMut.isError && (
              <p className="px-5 py-2 text-xs text-theme-danger text-center">{(assignWaiterMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* Change Status Modal */}
      {showStatusChange && contextTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowStatusChange(false); setContextTable(null); }}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-theme-text">Change Status</h3>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Table T{contextTable.tableNumber} · currently {contextTable.status.toLowerCase()}
                </p>
              </div>
              <button
                onClick={() => { setShowStatusChange(false); setContextTable(null); }}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={14} />
              </button>
            </header>
            <div className="p-4 space-y-2">
              {(['AVAILABLE', 'RESERVED', 'CLEANING'] as TableStatus[])
                .filter((s) => s !== contextTable.status)
                .map((status) => {
                  const STYLES: Record<string, string> = {
                    AVAILABLE: 'border-theme-pop text-theme-pop hover:bg-theme-pop hover:text-white',
                    RESERVED:  'border-theme-info text-theme-info hover:bg-theme-info hover:text-white',
                    CLEANING:  'border-theme-text-muted text-theme-text-muted hover:bg-theme-text-muted hover:text-white',
                  };
                  return (
                    <button
                      key={status}
                      onClick={() => changeStatusMut.mutate({ tableId: contextTable.id, status })}
                      disabled={changeStatusMut.isPending}
                      className={`w-full px-4 py-3 rounded-theme text-sm font-semibold border-2 transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${STYLES[status] ?? ''}`}
                    >
                      <Check size={14} /> {status.charAt(0) + status.slice(1).toLowerCase()}
                    </button>
                  );
                })}
            </div>
            {changeStatusMut.isError && (
              <p className="px-5 pb-3 text-xs text-theme-danger text-center">{(changeStatusMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* End Day Modal */}
      {showEndDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col">
            <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between shrink-0">
              <h3 className="text-lg font-bold text-theme-text">End Day · Closing Balance Reconciliation</h3>
              <button
                onClick={() => { setShowEndDay(false); setEndDaySummary(null); }}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={14} />
              </button>
            </header>

            <div className="overflow-auto flex-1">
              {loadingSummary ? (
                <div className="px-6 py-12 text-center">
                  <span className="text-theme-text-muted text-sm">Loading summary…</span>
                </div>
              ) : endDaySummary ? (
                <div className="p-6 space-y-4">
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-theme-bg rounded-theme p-3">
                      <p className="text-[10px] text-theme-text-muted uppercase tracking-wider">Orders</p>
                      <p className="text-xl font-extrabold text-theme-text mt-1">{endDaySummary.orderCount}</p>
                    </div>
                    <div className="bg-theme-bg rounded-theme p-3">
                      <p className="text-[10px] text-theme-text-muted uppercase tracking-wider">Sales</p>
                      <p className="text-xl font-extrabold text-theme-pop mt-1">{formatCurrency(endDaySummary.totalSales)}</p>
                    </div>
                    <div className="bg-theme-bg rounded-theme p-3">
                      <p className="text-[10px] text-theme-text-muted uppercase tracking-wider">Expenses</p>
                      <p className="text-xl font-extrabold text-theme-danger mt-1">{formatCurrency(endDaySummary.totalExpenses)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-2">Closing balance per account</p>
                    <p className="text-[11px] text-theme-text-muted mb-2">
                      Count the actual money in each drawer and enter it below. Discrepancies will be recorded in the day report but won't block closing.
                    </p>
                    <div className="space-y-2">
                      {(endDaySummary.posAccounts ?? []).map((acc) => {
                        // Expected = live system balance from the Account.balance field,
                        // so it always matches what the Accounts page shows.
                        const live = posAccounts.find((p) => p.id === acc.id);
                        const expected = Number(live?.balance ?? 0);
                        const diff = calcDiff(expected, closingBalances[acc.id] ?? '');
                        const tone =
                          diff === null ? { wrap: 'border-theme-border', tag: 'text-theme-text-muted', label: '' }
                          : diff === 0 ? { wrap: 'border-theme-pop bg-theme-pop/5', tag: 'text-theme-pop', label: 'MATCH' }
                          : diff > 0 ? { wrap: 'border-theme-danger/40 bg-theme-danger/5', tag: 'text-theme-danger', label: `SHORT ${formatCurrency(Math.abs(diff))}` }
                          : { wrap: 'border-theme-warn/40 bg-theme-warn/5', tag: 'text-theme-warn', label: `OVER ${formatCurrency(Math.abs(diff))}` };
                        return (
                          <div key={acc.id} className={`border-2 rounded-theme p-3 ${tone.wrap}`}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-semibold text-theme-text">{acc.name}</span>
                              <span className="text-theme-text-muted">
                                Expected: <span className="font-bold text-theme-text">{formatCurrency(expected)}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted text-sm">৳</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={closingBalances[acc.id] ?? ''}
                                onChange={(e) => setClosingBalances((b) => ({ ...b, [acc.id]: e.target.value }))}
                                placeholder="0.00"
                                className="flex-1 bg-theme-bg rounded-theme px-3 py-2 text-base font-bold text-theme-text outline-none border border-transparent focus:border-theme-accent"
                              />
                              {tone.label && <span className={`text-xs font-bold whitespace-nowrap ${tone.tag}`}>{tone.label}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    const hasDiscrepancy = (endDaySummary.posAccounts ?? []).some((acc) => {
                      const live = posAccounts.find((p) => p.id === acc.id);
                      const expected = Number(live?.balance ?? 0);
                      const d = calcDiff(expected, closingBalances[acc.id] ?? '');
                      return d !== null && d !== 0;
                    });
                    return hasDiscrepancy ? (
                      <div className="flex items-start gap-2 p-3 bg-theme-warn/10 border border-theme-warn/30 rounded-theme text-xs text-theme-text">
                        <span className="text-theme-warn shrink-0">⚠</span>
                        <p>Discrepancies detected. End-of-day will record the variance in the daily reconciliation report — closing is still allowed.</p>
                      </div>
                    ) : null;
                  })()}

                  {/* Consumed ingredients */}
                  {endDaySummary.consumedItems && endDaySummary.consumedItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">
                          Consumed ({endDaySummary.consumedItems.length} items)
                        </p>
                        <p className="text-xs font-bold text-theme-text">
                          Total: {formatCurrency(endDaySummary.consumedTotalValue ?? 0)}
                        </p>
                      </div>
                      <div className="border border-theme-border rounded-theme overflow-hidden max-h-60 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-theme-bg sticky top-0">
                            <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                              <th className="px-3 py-2 text-left">Ingredient</th>
                              <th className="px-3 py-2 text-right">Quantity</th>
                              <th className="px-3 py-2 text-right">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {endDaySummary.consumedItems.map((it) => (
                              <tr key={it.id} className="border-t border-theme-border">
                                <td className="px-3 py-1.5 text-theme-text">{it.name}</td>
                                <td className="px-3 py-1.5 text-right text-theme-text-muted">
                                  {it.quantity.toFixed(3)} {it.unit}
                                </td>
                                <td className="px-3 py-1.5 text-right font-bold text-theme-text">
                                  {formatCurrency(it.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Wasted ingredients */}
                  {endDaySummary.wasteItems && endDaySummary.wasteItems.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">
                          Wasted ({endDaySummary.wasteItems.length} items)
                        </p>
                        <p className="text-xs font-bold text-theme-danger">
                          Total: {formatCurrency(endDaySummary.wasteTotalValue ?? 0)}
                        </p>
                      </div>
                      <div className="border border-theme-danger/30 rounded-theme overflow-hidden max-h-60 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-theme-danger/10 sticky top-0">
                            <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                              <th className="px-3 py-2 text-left">Ingredient</th>
                              <th className="px-3 py-2 text-right">Quantity</th>
                              <th className="px-3 py-2 text-right">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {endDaySummary.wasteItems.map((it) => (
                              <tr key={it.id} className="border-t border-theme-border">
                                <td className="px-3 py-1.5 text-theme-text">{it.name}</td>
                                <td className="px-3 py-1.5 text-right text-theme-text-muted">
                                  {it.quantity.toFixed(3)} {it.unit}
                                </td>
                                <td className="px-3 py-1.5 text-right font-bold text-theme-danger">
                                  {formatCurrency(it.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 space-y-3">
                  <p className="text-sm text-theme-text-muted">
                    This will close the current work period and print the <strong className="text-theme-text">End of Day Report</strong>.
                  </p>
                  <p className="text-xs text-theme-danger font-semibold">
                    This action cannot be undone. A new day must be started afterwards.
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 pb-2 shrink-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                Confirm with your password
              </label>
              <input
                type="password"
                value={endPassword}
                onChange={(e) => { setEndPassword(e.target.value); setPwError(''); }}
                placeholder="Enter your POS password"
                className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              />
              {pwError && <p className="text-xs text-theme-danger mt-1.5">{pwError}</p>}
            </div>

            <footer className="px-6 py-4 border-t border-theme-border flex gap-3 shrink-0">
              <button
                onClick={() => { setShowEndDay(false); setEndDaySummary(null); setEndPassword(''); setPwError(''); }}
                className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setPwError('');
                  if (!endPassword || !user?.email) { setPwError('Password required'); return; }
                  try {
                    await api.post('/auth/verify-self', { email: user.email, password: endPassword });
                  } catch {
                    setPwError('Incorrect password');
                    return;
                  }
                  const accounts = endDaySummary?.posAccounts ?? posAccounts;
                  endDayMut.mutate({
                    closingBalances: Object.fromEntries(
                      accounts.map((a) => [a.id, Math.round(parseFloat(closingBalances[a.id] || '0') * 100)]),
                    ),
                  });
                }}
                disabled={endDayMut.isPending || loadingSummary || !endPassword}
                className="flex-1 bg-theme-accent hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40"
              >
                🖨 {endDayMut.isPending ? 'Closing…' : 'End Day & Print'}
              </button>
            </footer>

            {endDayMut.isError && (
              <p className="px-6 pb-4 text-xs text-theme-danger text-center">{(endDayMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
