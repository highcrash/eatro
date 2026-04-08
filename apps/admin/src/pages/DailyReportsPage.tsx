import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, X, Calendar } from 'lucide-react';

import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface WorkPeriod {
  id: string;
  startedAt: string;
  endedAt: string | null;
  startedBy?: { id: string; name: string } | null;
  endedBy?: { id: string; name: string } | null;
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
  consumedItems?: Array<{ id: string; name: string; unit: string; quantity: number; value: number }>;
  consumedTotalValue?: number;
  wasteItems?: Array<{ id: string; name: string; unit: string; quantity: number; value: number }>;
  wasteTotalValue?: number;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateOnly(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().slice(0, 10);
}

function printReport(summary: WorkPeriodSummary) {
  const { workPeriod: wp, totalSales, orderCount, voidedOrders, byPaymentMethod, byOrderType, totalExpenses, expenseCount, expenseByCategory, balances, posAccounts, consumedItems, consumedTotalValue, wasteItems, wasteTotalValue } = summary;

  const startTime = new Date(wp.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const endTime = wp.endedAt ? new Date(wp.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Open';

  const paymentRows = Object.entries(byPaymentMethod)
    .map(([m, a]) => `<tr><td>${m}</td><td style="text-align:right">${formatCurrency(a)}</td></tr>`).join('');
  const orderTypeRows = Object.entries(byOrderType)
    .map(([t, d]) => `<tr><td>${t.replace('_', ' ')}</td><td style="text-align:center">${d.count}</td><td style="text-align:right">${formatCurrency(d.total)}</td></tr>`).join('');
  const expenseRows = Object.entries(expenseByCategory)
    .map(([c, a]) => `<tr><td>${c.replace('_', ' ')}</td><td style="text-align:right">${formatCurrency(a)}</td></tr>`).join('');

  const reconRows = (posAccounts ?? []).map((acc) => {
    const opening = balances.openingByAccount?.[acc.id] ?? 0;
    const sales = balances.salesByAccount?.[acc.id] ?? 0;
    const exp = balances.expensesByAccount?.[acc.id] ?? 0;
    const sup = balances.supplierByAccount?.[acc.id] ?? 0;
    const sal = balances.salaryByAccount?.[acc.id] ?? 0;
    const expected = balances.expectedByAccount?.[acc.id] ?? 0;
    const actual = balances.closingByAccount?.[acc.id];
    const diff = actual != null ? expected - actual : 0;
    const diffStyle = diff !== 0 ? 'color:#D62B2B;font-weight:bold' : '';
    return `<tr>
      <td>${acc.name}</td>
      <td style="text-align:right">${formatCurrency(opening)}</td>
      <td style="text-align:right">${formatCurrency(sales)}</td>
      <td style="text-align:right">${formatCurrency(exp)}</td>
      <td style="text-align:right">${formatCurrency(sup)}</td>
      <td style="text-align:right">${formatCurrency(sal)}</td>
      <td style="text-align:right;font-weight:bold">${formatCurrency(expected)}</td>
      <td style="text-align:right">${actual != null ? formatCurrency(actual) : '—'}</td>
      <td style="text-align:right;${diffStyle}">${actual != null ? formatCurrency(diff) : '—'}</td>
    </tr>`;
  }).join('');

  const netCash = totalSales - totalExpenses;
  const html = `<html><head><title>Daily Report — ${fmtDateOnly(wp.startedAt)}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px;max-width:900px;margin:0 auto}
      h1{font-size:22px;margin-bottom:4px}h2{font-size:13px;margin:14px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px;text-transform:uppercase;letter-spacing:1px}
      .meta{font-size:11px;color:#666;margin-bottom:10px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px}
      th,td{padding:5px 6px;text-align:left}th{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #aaa}
      tr td{border-bottom:1px solid #eee}
      .recon{font-size:10px}
      .total-row td{font-weight:bold;font-size:13px;padding-top:6px;border-top:1px solid #111}
      .big{font-size:22px;font-weight:bold;text-align:center;margin:12px 0;padding:8px;background:#FAF9F7}
    </style></head><body>
    <h1>End of Day Report</h1>
    <div class="meta">${startTime} → ${endTime}</div>

    <h2>Sales Summary</h2>
    <table>
      <tr><td>Total Orders</td><td style="text-align:right">${orderCount}</td></tr>
      <tr><td>Voided Orders</td><td style="text-align:right">${voidedOrders}</td></tr>
    </table>
    <div class="big">${formatCurrency(totalSales)}</div>

    <h2>By Payment Method</h2>
    <table>${paymentRows || '<tr><td colspan="2" style="text-align:center;color:#999">No sales</td></tr>'}</table>

    <h2>By Order Type</h2>
    <table>
      <tr style="font-size:9px;color:#666;text-transform:uppercase"><td>Type</td><td style="text-align:center">Qty</td><td style="text-align:right">Amount</td></tr>
      ${orderTypeRows || '<tr><td colspan="3" style="text-align:center;color:#999">No sales</td></tr>'}
    </table>

    <h2>Expenses (${expenseCount})</h2>
    <table>${expenseRows || '<tr><td colspan="2" style="text-align:center;color:#999">No expenses</td></tr>'}</table>
    <table><tr class="total-row"><td>Total Expenses</td><td style="text-align:right">${formatCurrency(totalExpenses)}</td></tr></table>
    <table><tr class="total-row"><td>NET (Sales − Expenses)</td><td style="text-align:right">${formatCurrency(netCash)}</td></tr></table>

    <h2>Balance Reconciliation</h2>
    <table class="recon">
      <tr>
        <th>Account</th><th style="text-align:right">Opening</th><th style="text-align:right">+Sales</th>
        <th style="text-align:right">−Expense</th><th style="text-align:right">−Supplier</th><th style="text-align:right">−Salary</th>
        <th style="text-align:right">=Expected</th><th style="text-align:right">Actual</th><th style="text-align:right">Diff</th>
      </tr>
      ${reconRows || '<tr><td colspan="9" style="text-align:center;color:#999">No accounts</td></tr>'}
    </table>

    ${consumedItems && consumedItems.length > 0 ? `
    <h2>Consumed Ingredients (${consumedItems.length})</h2>
    <table>
      <tr><th style="text-align:left">Ingredient</th><th style="text-align:right">Quantity</th><th style="text-align:right">Value</th></tr>
      ${consumedItems.map((it) => `<tr><td>${it.name}</td><td style="text-align:right">${it.quantity.toFixed(3)} ${it.unit}</td><td style="text-align:right">${formatCurrency(it.value)}</td></tr>`).join('')}
      <tr class="total-row"><td>TOTAL CONSUMED</td><td></td><td style="text-align:right">${formatCurrency(consumedTotalValue ?? 0)}</td></tr>
    </table>` : ''}

    ${wasteItems && wasteItems.length > 0 ? `
    <h2>Wasted Items (${wasteItems.length})</h2>
    <table>
      <tr><th style="text-align:left">Ingredient</th><th style="text-align:right">Quantity</th><th style="text-align:right">Value</th></tr>
      ${wasteItems.map((it) => `<tr><td>${it.name}</td><td style="text-align:right">${it.quantity.toFixed(3)} ${it.unit}</td><td style="text-align:right;color:#D62B2B">${formatCurrency(it.value)}</td></tr>`).join('')}
      <tr class="total-row"><td>TOTAL WASTE</td><td></td><td style="text-align:right;color:#D62B2B">${formatCurrency(wasteTotalValue ?? 0)}</td></tr>
    </table>` : ''}

    <p style="margin-top:24px;text-align:center;font-size:10px;color:#999">— End of Report —</p>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) { win.document.write(html); win.document.close(); }
}

// ───────── Detail modal ─────────
function ReportDetailModal({ wpId, onClose }: { wpId: string; onClose: () => void }) {
  const { data: summary, isLoading } = useQuery<WorkPeriodSummary>({
    queryKey: ['work-period-summary', wpId],
    queryFn: () => api.get(`/work-periods/${wpId}/summary`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white border border-[#2A2A2A] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between bg-[#0D0D0D]">
          <div>
            <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Daily Report</p>
            <h2 className="font-display text-2xl text-white tracking-wide">
              {summary ? fmtDateOnly(summary.workPeriod.startedAt) : 'Loading…'}
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => summary && printReport(summary)}
              disabled={!summary}
              className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-3 py-2 text-xs font-body font-medium hover:bg-[#F03535] transition-colors disabled:opacity-40"
            >
              <Printer size={14} /> Print
            </button>
            <button onClick={onClose} className="text-[#999] hover:text-white">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="overflow-auto flex-1 p-6 bg-[#0D0D0D] text-white">
          {isLoading || !summary ? (
            <p className="text-[#999] text-sm">Loading…</p>
          ) : (
            <div className="space-y-6">
              {/* Top stats */}
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Orders" value={String(summary.orderCount)} />
                <Stat label="Voided" value={String(summary.voidedOrders)} />
                <Stat label="Total Sales" value={formatCurrency(summary.totalSales)} accent="text-[#4CAF50]" />
                <Stat label="Total Expenses" value={formatCurrency(summary.totalExpenses)} accent="text-[#D62B2B]" />
              </div>

              {/* By payment method */}
              <Section title="By Payment Method">
                {Object.keys(summary.byPaymentMethod).length === 0 ? (
                  <p className="text-[#666] text-xs font-body">No sales</p>
                ) : (
                  <table className="w-full text-xs font-body">
                    <tbody>
                      {Object.entries(summary.byPaymentMethod).map(([m, a]) => (
                        <tr key={m} className="border-b border-[#1F1F1F]">
                          <td className="py-1.5 text-[#DDD9D3]">{m}</td>
                          <td className="py-1.5 text-right text-white font-medium">{formatCurrency(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* By order type */}
              <Section title="By Order Type">
                {Object.keys(summary.byOrderType).length === 0 ? (
                  <p className="text-[#666] text-xs font-body">No sales</p>
                ) : (
                  <table className="w-full text-xs font-body">
                    <thead>
                      <tr className="text-[10px] text-[#666] tracking-widest uppercase">
                        <td className="py-1">Type</td>
                        <td className="py-1 text-center">Qty</td>
                        <td className="py-1 text-right">Amount</td>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary.byOrderType).map(([t, d]) => (
                        <tr key={t} className="border-b border-[#1F1F1F]">
                          <td className="py-1.5 text-[#DDD9D3]">{t.replace('_', ' ')}</td>
                          <td className="py-1.5 text-center text-[#DDD9D3]">{d.count}</td>
                          <td className="py-1.5 text-right text-white font-medium">{formatCurrency(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Expenses */}
              <Section title={`Expenses (${summary.expenseCount})`}>
                {summary.expenseCount === 0 ? (
                  <p className="text-[#666] text-xs font-body">No expenses</p>
                ) : (
                  <table className="w-full text-xs font-body">
                    <tbody>
                      {Object.entries(summary.expenseByCategory).map(([c, a]) => (
                        <tr key={c} className="border-b border-[#1F1F1F]">
                          <td className="py-1.5 text-[#DDD9D3]">{c.replace('_', ' ')}</td>
                          <td className="py-1.5 text-right text-white font-medium">{formatCurrency(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Reconciliation */}
              <Section title="Balance Reconciliation">
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-body">
                    <thead>
                      <tr className="text-[9px] text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
                        <td className="py-1.5 pr-2">Account</td>
                        <td className="py-1.5 px-1 text-right">Opening</td>
                        <td className="py-1.5 px-1 text-right">+Sales</td>
                        <td className="py-1.5 px-1 text-right">−Exp</td>
                        <td className="py-1.5 px-1 text-right">−Sup</td>
                        <td className="py-1.5 px-1 text-right">−Sal</td>
                        <td className="py-1.5 px-1 text-right">=Expected</td>
                        <td className="py-1.5 px-1 text-right">Actual</td>
                        <td className="py-1.5 pl-1 text-right">Diff</td>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary.posAccounts ?? []).map((acc) => {
                        const opening = summary.balances.openingByAccount?.[acc.id] ?? 0;
                        const sales = summary.balances.salesByAccount?.[acc.id] ?? 0;
                        const exp = summary.balances.expensesByAccount?.[acc.id] ?? 0;
                        const sup = summary.balances.supplierByAccount?.[acc.id] ?? 0;
                        const sal = summary.balances.salaryByAccount?.[acc.id] ?? 0;
                        const expected = summary.balances.expectedByAccount?.[acc.id] ?? 0;
                        const actual = summary.balances.closingByAccount?.[acc.id];
                        const diff = actual != null ? expected - actual : null;
                        return (
                          <tr key={acc.id} className="border-b border-[#1F1F1F]">
                            <td className="py-1.5 pr-2 text-[#DDD9D3] font-medium">{acc.name}</td>
                            <td className="py-1.5 px-1 text-right text-[#999]">{formatCurrency(opening)}</td>
                            <td className="py-1.5 px-1 text-right text-[#4CAF50]">{formatCurrency(sales)}</td>
                            <td className="py-1.5 px-1 text-right text-[#D62B2B]">{formatCurrency(exp)}</td>
                            <td className="py-1.5 px-1 text-right text-[#D62B2B]">{formatCurrency(sup)}</td>
                            <td className="py-1.5 px-1 text-right text-[#D62B2B]">{formatCurrency(sal)}</td>
                            <td className="py-1.5 px-1 text-right text-white font-bold">{formatCurrency(expected)}</td>
                            <td className="py-1.5 px-1 text-right text-[#DDD9D3]">{actual != null ? formatCurrency(actual) : '—'}</td>
                            <td className={`py-1.5 pl-1 text-right font-bold ${diff === null ? 'text-[#666]' : diff === 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>
                              {diff === null ? '—' : formatCurrency(diff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Consumed ingredients */}
              {summary.consumedItems && summary.consumedItems.length > 0 && (
                <Section title={`Consumed Ingredients (${summary.consumedItems.length})`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-body">
                      <thead>
                        <tr className="text-[9px] text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
                          <td className="py-1.5 pr-2">Ingredient</td>
                          <td className="py-1.5 px-1 text-right">Quantity</td>
                          <td className="py-1.5 pl-1 text-right">Value</td>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.consumedItems.map((it) => (
                          <tr key={it.id} className="border-b border-[#1F1F1F]">
                            <td className="py-1.5 pr-2 text-[#DDD9D3]">{it.name}</td>
                            <td className="py-1.5 px-1 text-right text-[#999]">
                              {it.quantity.toFixed(3)} {it.unit}
                            </td>
                            <td className="py-1.5 pl-1 text-right text-white font-medium">
                              {formatCurrency(it.value)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-[#2A2A2A]">
                          <td className="py-2 pr-2 text-white font-bold uppercase tracking-wider text-[10px]">Total Consumed</td>
                          <td className="py-2 px-1" />
                          <td className="py-2 pl-1 text-right text-[#4CAF50] font-bold">
                            {formatCurrency(summary.consumedTotalValue ?? 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Wasted ingredients */}
              {summary.wasteItems && summary.wasteItems.length > 0 && (
                <Section title={`Wasted Items (${summary.wasteItems.length})`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs font-body">
                      <thead>
                        <tr className="text-[9px] text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
                          <td className="py-1.5 pr-2">Ingredient</td>
                          <td className="py-1.5 px-1 text-right">Quantity</td>
                          <td className="py-1.5 pl-1 text-right">Value</td>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.wasteItems.map((it) => (
                          <tr key={it.id} className="border-b border-[#1F1F1F]">
                            <td className="py-1.5 pr-2 text-[#DDD9D3]">{it.name}</td>
                            <td className="py-1.5 px-1 text-right text-[#999]">
                              {it.quantity.toFixed(3)} {it.unit}
                            </td>
                            <td className="py-1.5 pl-1 text-right text-[#D62B2B] font-medium">
                              {formatCurrency(it.value)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-[#2A2A2A]">
                          <td className="py-2 pr-2 text-white font-bold uppercase tracking-wider text-[10px]">Total Waste</td>
                          <td className="py-2 px-1" />
                          <td className="py-2 pl-1 text-right text-[#D62B2B] font-bold">
                            {formatCurrency(summary.wasteTotalValue ?? 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border border-[#2A2A2A] p-3 bg-[#161616]">
      <p className="text-[10px] text-[#666] tracking-widest uppercase font-body">{label}</p>
      <p className={`font-display text-xl mt-1 ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[#666] tracking-widest uppercase font-body font-medium mb-2">{title}</p>
      <div className="border border-[#2A2A2A] p-4 bg-[#161616]">{children}</div>
    </div>
  );
}

// ───────── Main page ─────────
export default function DailyReportsPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: periods = [], isLoading } = useQuery<WorkPeriod[]>({
    queryKey: ['work-periods', from, to],
    queryFn: () => api.get(`/work-periods?from=${from}&to=${to}`),
  });

  const ended = useMemo(() => periods.filter((p) => p.endedAt != null), [periods]);

  const setQuickRange = (days: number) => {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Finance</p>
          <h1 className="font-display text-white text-4xl tracking-wide">DAILY REPORTS</h1>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[#666]" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body focus:outline-none focus:border-[#D62B2B]"
          />
          <span className="text-[#666] text-xs">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body focus:outline-none focus:border-[#D62B2B]"
          />
          <div className="flex gap-1 ml-2">
            {[
              { d: 7, l: '7d' },
              { d: 30, l: '30d' },
              { d: 90, l: '90d' },
            ].map(({ d, l }) => (
              <button
                key={l}
                onClick={() => setQuickRange(d)}
                className="px-2 py-2 text-[10px] font-body text-[#999] border border-[#2A2A2A] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors tracking-widest uppercase"
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <p className="text-[#666] font-body text-sm">Loading…</p>
        ) : ended.length === 0 ? (
          <p className="text-[#666] font-body text-sm">No closed work periods in this range.</p>
        ) : (
          <table className="w-full font-body text-sm">
            <thead className="bg-[#161616]">
              <tr className="text-[10px] text-[#666] tracking-widest uppercase">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Started</th>
                <th className="px-4 py-3 text-left">Ended</th>
                <th className="px-4 py-3 text-left">Started By</th>
                <th className="px-4 py-3 text-left">Ended By</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {ended.map((p) => (
                <tr key={p.id} className="border-t border-[#2A2A2A] hover:bg-[#161616] transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{fmtDateOnly(p.startedAt)}</td>
                  <td className="px-4 py-3 text-[#DDD9D3]">{fmtDate(p.startedAt)}</td>
                  <td className="px-4 py-3 text-[#DDD9D3]">{p.endedAt ? fmtDate(p.endedAt) : '—'}</td>
                  <td className="px-4 py-3 text-[#999]">{p.startedBy?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-[#999]">{p.endedBy?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setOpenId(p.id)}
                      className="text-[10px] font-body bg-[#D62B2B] text-white px-3 py-1.5 hover:bg-[#F03535] transition-colors tracking-widest uppercase"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openId && <ReportDetailModal wpId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
