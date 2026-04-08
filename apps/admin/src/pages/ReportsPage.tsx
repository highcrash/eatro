import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';

type Period = 'today' | 'week' | 'month' | 'year';

interface SalesSummary {
  period: string;
  from: string;
  to: string;
  orderCount: number;
  voidedOrders: number;
  totalRevenue: number;
  totalSubtotal: number;
  totalTax: number;
  totalDiscount: number;
  averageOrderValue: number;
  byPaymentMethod: Record<string, number>;
  byOrderType: Record<string, number>;
}

interface TopItem {
  menuItemId: string;
  name: string;
  totalQuantity: number;
  totalRevenue: number;
}

interface CategoryRevenue {
  categoryId: string;
  name: string;
  revenue: number;
  quantity: number;
}

interface DailySale {
  date: string;
  revenue: number;
  orders: number;
}

interface PurchasingSummary {
  purchaseOrderCount: number;
  totalSpent: number;
}

interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Record<string, number>;
  byPaymentMethod: Record<string, number>;
  from: string;
  to: string;
}

const CAT_LABELS: Record<string, string> = {
  RENT: 'Rent', UTILITIES: 'Utilities', SALARY: 'Salary', SUPPLIES: 'Supplies',
  MAINTENANCE: 'Maintenance', TRANSPORT: 'Transport', MARKETING: 'Marketing',
  FOOD_COST: 'Food Cost', STAFF_FOOD: 'Staff Food', MISCELLANEOUS: 'Misc',
};

function rangeForPeriod(period: 'today' | 'week' | 'month' | 'year'): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now);
  if (period === 'today') {
    // same day
  } else if (period === 'week') {
    from.setDate(now.getDate() - 6);
  } else if (period === 'month') {
    from.setDate(1);
  } else {
    from.setMonth(0, 1);
  }
  return { from: from.toISOString().slice(0, 10), to };
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('today');

  const { data: summary, isLoading: summaryLoading } = useQuery<SalesSummary>({
    queryKey: ['reports-summary', period],
    queryFn: () => api.get(`/reports/sales-summary?period=${period}`),
  });

  const { data: topItems = [] } = useQuery<TopItem[]>({
    queryKey: ['reports-top-items', period],
    queryFn: () => api.get(`/reports/top-items?period=${period}&limit=10`),
  });

  const { data: byCategory = [] } = useQuery<CategoryRevenue[]>({
    queryKey: ['reports-category', period],
    queryFn: () => api.get(`/reports/revenue-by-category?period=${period}`),
  });

  const { data: dailySales = [] } = useQuery<DailySale[]>({
    queryKey: ['reports-daily'],
    queryFn: () => api.get('/reports/daily-sales?days=14'),
    staleTime: 60_000,
  });

  const { data: purchasing } = useQuery<PurchasingSummary>({
    queryKey: ['reports-purchasing', period],
    queryFn: () => api.get(`/reports/purchasing-summary?period=${period}`),
  });

  const { from: expFrom, to: expTo } = rangeForPeriod(period);
  const { data: expenseSummary } = useQuery<ExpenseSummary>({
    queryKey: ['reports-expenses', period],
    queryFn: () => api.get(`/expenses/summary?from=${expFrom}&to=${expTo}`),
  });

  const totalRevenue = summary?.totalRevenue ?? 0;
  const maxDailyRevenue = Math.max(...dailySales.map((d) => d.revenue), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">FINANCE & REPORTS</h1>
        {/* Period selector */}
        <div className="flex">
          {(['today', 'week', 'month', 'year'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 font-body text-xs tracking-widest uppercase transition-colors border border-[#2A2A2A] -ml-px first:ml-0 ${
                period === p ? 'bg-[#D62B2B] text-white border-[#D62B2B] z-10 relative' : 'bg-[#161616] text-[#666] hover:text-[#999]'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'This Year'}
            </button>
          ))}
        </div>
      </div>

      {summaryLoading ? (
        <p className="text-[#666] font-body text-sm">Loading…</p>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: formatCurrency(summary?.totalRevenue ?? 0), sub: `${summary?.orderCount ?? 0} orders` },
              { label: 'Avg Order Value', value: formatCurrency(summary?.averageOrderValue ?? 0), sub: 'Per paid order' },
              { label: 'Tax Collected', value: formatCurrency(summary?.totalTax ?? 0), sub: 'Included in revenue' },
              { label: 'Void Orders', value: String(summary?.voidedOrders ?? 0), sub: 'Cancelled orders' },
            ].map((card) => (
              <div key={card.label} className="bg-[#161616] border border-[#2A2A2A] p-5">
                <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-2">{card.label}</p>
                <p className="font-display text-white text-3xl tracking-wide">{card.value}</p>
                <p className="text-[#666] font-body text-xs mt-1">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Row: Payment Method + Order Type */}
          <div className="grid grid-cols-2 gap-4">
            {/* Payment Method */}
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <h3 className="font-display text-lg text-white tracking-widest mb-4">BY PAYMENT METHOD</h3>
              {Object.entries(summary?.byPaymentMethod ?? {}).length === 0 ? (
                <p className="text-[#666] font-body text-sm">No data</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {Object.entries(summary?.byPaymentMethod ?? {}).map(([method, amount]) => (
                      <tr key={method} className="border-b border-[#2A2A2A] last:border-0">
                        <td className="py-2 text-[#999] font-body text-sm">{method}</td>
                        <td className="py-2 text-white font-body text-sm text-right">{formatCurrency(amount)}</td>
                        <td className="py-2 text-[#666] font-body text-xs text-right pl-4">
                          {totalRevenue > 0 ? `${Math.round((amount / totalRevenue) * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Order Type */}
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <h3 className="font-display text-lg text-white tracking-widest mb-4">BY ORDER TYPE</h3>
              {Object.entries(summary?.byOrderType ?? {}).length === 0 ? (
                <p className="text-[#666] font-body text-sm">No data</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {Object.entries(summary?.byOrderType ?? {}).map(([type, amount]) => (
                      <tr key={type} className="border-b border-[#2A2A2A] last:border-0">
                        <td className="py-2 text-[#999] font-body text-sm">{type.replace('_', ' ')}</td>
                        <td className="py-2 text-white font-body text-sm text-right">{formatCurrency(amount)}</td>
                        <td className="py-2 text-[#666] font-body text-xs text-right pl-4">
                          {totalRevenue > 0 ? `${Math.round((amount / totalRevenue) * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Row: Top Items + Category Revenue */}
          <div className="grid grid-cols-2 gap-4">
            {/* Top Items */}
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <h3 className="font-display text-lg text-white tracking-widest mb-4">TOP SELLING ITEMS</h3>
              {topItems.length === 0 ? (
                <p className="text-[#666] font-body text-sm">No data</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#2A2A2A]">
                      <th className="text-left pb-2 text-[#666] font-body text-xs tracking-widest uppercase">#</th>
                      <th className="text-left pb-2 text-[#666] font-body text-xs tracking-widest uppercase">Item</th>
                      <th className="text-right pb-2 text-[#666] font-body text-xs tracking-widest uppercase">Qty</th>
                      <th className="text-right pb-2 text-[#666] font-body text-xs tracking-widest uppercase">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.map((item, idx) => (
                      <tr key={item.menuItemId} className="border-b border-[#2A2A2A] last:border-0">
                        <td className="py-2 text-[#666] font-body text-xs">{idx + 1}</td>
                        <td className="py-2 text-white font-body text-sm">{item.name}</td>
                        <td className="py-2 text-[#999] font-body text-sm text-right">{item.totalQuantity}</td>
                        <td className="py-2 text-white font-body text-sm text-right">{formatCurrency(item.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Revenue by Category */}
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <h3 className="font-display text-lg text-white tracking-widest mb-4">REVENUE BY CATEGORY</h3>
              {byCategory.length === 0 ? (
                <p className="text-[#666] font-body text-sm">No data</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#2A2A2A]">
                      <th className="text-left pb-2 text-[#666] font-body text-xs tracking-widest uppercase">Category</th>
                      <th className="text-right pb-2 text-[#666] font-body text-xs tracking-widest uppercase">Revenue</th>
                      <th className="text-right pb-2 text-[#666] font-body text-xs tracking-widest uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCategory.map((cat) => (
                      <tr key={cat.categoryId} className="border-b border-[#2A2A2A] last:border-0">
                        <td className="py-2 text-white font-body text-sm">{cat.name}</td>
                        <td className="py-2 text-white font-body text-sm text-right">{formatCurrency(cat.revenue)}</td>
                        <td className="py-2 text-[#666] font-body text-xs text-right">
                          {totalRevenue > 0 ? `${Math.round((cat.revenue / totalRevenue) * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Daily Sales — last 14 days bar chart (CSS bars) */}
          <div className="bg-[#161616] border border-[#2A2A2A] p-5">
            <h3 className="font-display text-lg text-white tracking-widest mb-6">DAILY SALES (LAST 14 DAYS)</h3>
            <div className="flex items-end gap-1 h-32">
              {dailySales.slice(-14).map((day) => {
                const heightPct = maxDailyRevenue > 0 ? (day.revenue / maxDailyRevenue) * 100 : 0;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                      <div
                        className="w-full bg-[#D62B2B] group-hover:bg-[#F03535] transition-colors relative"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                        title={`${day.date}: ${formatCurrency(day.revenue)} (${day.orders} orders)`}
                      />
                    </div>
                    <p className="text-[#666] font-body text-xs" style={{ fontSize: '10px' }}>
                      {day.date.slice(5)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expense Summary */}
          {expenseSummary && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg text-white tracking-widest">EXPENSES</h3>
                <span className="text-[#666] font-body text-[10px] tracking-widest uppercase">
                  {expenseSummary.from} → {expenseSummary.to}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-6 mb-6">
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Total Spent</p>
                  <p className="font-display text-3xl text-[#D62B2B]">{formatCurrency(expenseSummary.total)}</p>
                </div>
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Entries</p>
                  <p className="font-display text-3xl text-white">{expenseSummary.count}</p>
                </div>
                {totalRevenue > 0 && (
                  <div>
                    <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">% of Revenue</p>
                    <p className="font-display text-3xl text-white">
                      {((expenseSummary.total / totalRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>
                )}
              </div>

              {/* By category */}
              {Object.keys(expenseSummary.byCategory).length > 0 && (
                <div className="mb-6">
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-3">By Category</p>
                  <div className="space-y-2">
                    {Object.entries(expenseSummary.byCategory)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, amt]) => {
                        const pct = expenseSummary.total > 0 ? (amt / expenseSummary.total) * 100 : 0;
                        return (
                          <div key={cat}>
                            <div className="flex items-center justify-between text-xs font-body mb-1">
                              <span className="text-white">{CAT_LABELS[cat] ?? cat}</span>
                              <span className="text-[#999]">{formatCurrency(amt)} <span className="text-[#666] ml-1">({pct.toFixed(1)}%)</span></span>
                            </div>
                            <div className="h-1.5 bg-[#0D0D0D]">
                              <div className="h-full bg-[#D62B2B]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* By payment method */}
              {Object.keys(expenseSummary.byPaymentMethod).length > 0 && (
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-3">By Payment Method</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(expenseSummary.byPaymentMethod)
                      .sort(([, a], [, b]) => b - a)
                      .map(([method, amt]) => (
                        <div key={method} className="flex items-center justify-between bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2">
                          <span className="text-white font-body text-xs">{method}</span>
                          <span className="text-[#999] font-body text-xs">{formatCurrency(amt)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {expenseSummary.count === 0 && (
                <p className="text-[#666] font-body text-sm text-center py-4">No expenses in this period.</p>
              )}
            </div>
          )}

          {/* Purchasing Summary */}
          {purchasing && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-5">
              <h3 className="font-display text-lg text-white tracking-widest mb-4">PURCHASING COST</h3>
              <div className="flex gap-8">
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Purchase Orders Received</p>
                  <p className="font-display text-white text-3xl">{purchasing.purchaseOrderCount}</p>
                </div>
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Total Stock Cost</p>
                  <p className="font-display text-white text-3xl">{formatCurrency(purchasing.totalSpent)}</p>
                </div>
                {totalRevenue > 0 && (
                  <div>
                    <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Gross Margin (Est.)</p>
                    <p className={`font-display text-3xl ${totalRevenue - purchasing.totalSpent > 0 ? 'text-[#4CAF50]' : 'text-[#D62B2B]'}`}>
                      {formatCurrency(totalRevenue - purchasing.totalSpent)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
