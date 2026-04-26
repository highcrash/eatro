import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, TrendingUp, TrendingDown } from 'lucide-react';

import type { PerformanceReport } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

type Tab = 'items' | 'categories' | 'volatility';

function marginColour(pct: number | null): string {
  if (pct == null) return 'text-[#666]';
  if (pct >= 50) return 'text-green-500';
  if (pct >= 25) return 'text-[#FFA726]';
  return 'text-[#D62B2B]';
}

export default function PerformanceReportPage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<Tab>('items');

  const { data, isLoading } = useQuery<PerformanceReport>({
    queryKey: ['performance-report', from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get<PerformanceReport>(`/reports/performance?${params.toString()}`);
    },
  });

  const items = data?.items ?? [];
  const categories = data?.categories ?? [];
  const volatility = data?.inventoryVolatility ?? [];

  const totals = useMemo(() => {
    const revenue = items.reduce((s, r) => s + Number(r.revenue), 0);
    const cogs = items.reduce((s, r) => s + Number(r.cogs), 0);
    const gp = revenue - cogs;
    const m = revenue > 0 && cogs > 0 ? (gp / revenue) * 100 : null;
    return { revenue, cogs, grossProfit: gp, marginPct: m, quantity: items.reduce((s, r) => s + r.quantity, 0) };
  }, [items]);

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=1100,height=700');
    if (!w) return;
    const itemRows = items.map((r, idx) => `<tr>
      <td>${idx + 1}</td><td>${r.name}</td><td>${r.categoryName}</td>
      <td class="r">${r.quantity}</td>
      <td class="r">${formatCurrency(Number(r.revenue))}</td>
      <td class="r">${formatCurrency(Number(r.cogs))}</td>
      <td class="r">${formatCurrency(Number(r.grossProfit))}</td>
      <td class="r">${r.marginPct == null ? '—' : r.marginPct.toFixed(1) + '%'}</td>
    </tr>`).join('');
    const catRows = categories.map((c, idx) => `<tr>
      <td>${idx + 1}</td><td>${c.categoryName}</td>
      <td class="r">${c.quantity}</td>
      <td class="r">${formatCurrency(Number(c.revenue))}</td>
      <td class="r">${formatCurrency(Number(c.cogs))}</td>
      <td class="r">${formatCurrency(Number(c.grossProfit))}</td>
      <td class="r">${c.marginPct == null ? '—' : c.marginPct.toFixed(1) + '%'}</td>
    </tr>`).join('');
    const volRows = volatility.map((v, idx) => {
      // Costs are per PURCHASE unit; show that explicitly so the
      // print doesn't mislead the reader the same way the screen
      // used to.
      const purchaseUnit = (v as any).purchaseUnit ?? v.unit;
      const stockUnit = (v as any).stockUnit ?? v.unit;
      const purchaseUnitQty = Number((v as any).purchaseUnitQty ?? 1) || 1;
      const unitLabel = purchaseUnit && stockUnit && purchaseUnit.toUpperCase() !== stockUnit.toUpperCase()
        ? `${purchaseUnit} (= ${purchaseUnitQty} ${stockUnit})`
        : purchaseUnit;
      return `<tr>
        <td>${idx + 1}</td><td>${v.ingredientName}</td><td>${unitLabel}</td>
        <td class="r">${v.deliveries}</td>
        <td class="r">${formatCurrency(Number(v.minUnitCost))}</td>
        <td class="r">${formatCurrency(Number(v.avgUnitCost))}</td>
        <td class="r">${formatCurrency(Number(v.maxUnitCost))}</td>
        <td class="r">${formatCurrency(Number(v.latestUnitCost))}</td>
      </tr>`;
    }).join('');
    w.document.write(`<html><head><title>Performance Report</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#111;padding:20px}
      h1{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;margin-bottom:4px}
      h2{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;margin:20px 0 6px}
      .meta{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:6px 4px;font-weight:600}
      td{padding:5px 4px;border-bottom:1px solid #F2F1EE;font-size:10px}.r{text-align:right}
      @media print{body{padding:8mm}}
    </style></head><body>
      <h1>PERFORMANCE REPORT</h1>
      <div class="meta">From ${from} to ${to}</div>
      <h2>By Menu Item</h2>
      <table><thead><tr><th>#</th><th>Item</th><th>Category</th><th class="r">Qty</th><th class="r">Revenue</th><th class="r">COGS</th><th class="r">Gross</th><th class="r">Margin</th></tr></thead><tbody>${itemRows}</tbody></table>
      <h2>By Category</h2>
      <table><thead><tr><th>#</th><th>Category</th><th class="r">Qty</th><th class="r">Revenue</th><th class="r">COGS</th><th class="r">Gross</th><th class="r">Margin</th></tr></thead><tbody>${catRows}</tbody></table>
      <h2>Inventory Price Volatility <span style="font-size:9px;font-weight:400;color:#666;letter-spacing:0">(prices per purchase unit)</span></h2>
      <table><thead><tr><th>#</th><th>Ingredient</th><th>Per Unit</th><th class="r">Deliveries</th><th class="r">Min</th><th class="r">Avg</th><th class="r">Max</th><th class="r">Latest</th></tr></thead><tbody>${volRows}</tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Reports</p>
          <h1 className="font-display text-4xl text-white tracking-wide">PERFORMANCE</h1>
          {data?.suggestedCustomMenuMargin != null && (
            <p className="text-[10px] text-[#FFA726] font-body mt-1 tracking-widest uppercase">
              Avg margin across items with cost: {data.suggestedCustomMenuMargin.toFixed(1)}% (use as Custom Menu margin baseline)
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handlePrint} className="flex items-center gap-1.5 border border-[#2A2A2A] px-3 py-1.5 text-xs font-body text-[#999] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors">
            <Printer size={12} /> Print / PDF
          </button>
        </div>
      </div>

      {/* Date range */}
      <div className="bg-[#161616] border border-[#2A2A2A] p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
          </div>
        </div>
      </div>

      {/* Top-line totals */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Revenue</p>
          <p className="font-display text-2xl text-white mt-1">{formatCurrency(totals.revenue)}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">COGS</p>
          <p className="font-display text-2xl text-[#FFA726] mt-1">{formatCurrency(totals.cogs)}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Gross Profit</p>
          <p className="font-display text-2xl text-green-500 mt-1">{formatCurrency(totals.grossProfit)}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-4">
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Margin</p>
          <p className={`font-display text-2xl mt-1 ${marginColour(totals.marginPct)}`}>
            {totals.marginPct == null ? '—' : totals.marginPct.toFixed(1) + '%'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="flex gap-0 border-b border-[#2A2A2A]">
          {([
            { id: 'items', label: `By Item (${items.length})` },
            { id: 'categories', label: `By Category (${categories.length})` },
            { id: 'volatility', label: `Price Volatility (${volatility.length})` },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[10px] font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${
                tab === t.id ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666] hover:text-[#999]'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* By Item */}
        {tab === 'items' && (
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">COGS</th>
                <th className="px-4 py-3 font-medium text-right">Gross Profit</th>
                <th className="px-4 py-3 font-medium text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#999]">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[#999]">No paid orders in this range.</td></tr>
              ) : items.map((r, idx) => (
                <tr key={r.menuItemId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-2.5 text-[#666] text-xs">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-white text-sm">{r.name}</td>
                  <td className="px-4 py-2.5 text-[#999] text-xs">{r.categoryName}</td>
                  <td className="px-4 py-2.5 text-right text-[#999] text-xs">{r.quantity}×</td>
                  <td className="px-4 py-2.5 text-right text-white text-xs">{formatCurrency(Number(r.revenue))}</td>
                  <td className="px-4 py-2.5 text-right text-[#FFA726] text-xs">{formatCurrency(Number(r.cogs))}</td>
                  <td className="px-4 py-2.5 text-right text-green-500 text-xs">{formatCurrency(Number(r.grossProfit))}</td>
                  <td className={`px-4 py-2.5 text-right text-xs font-medium ${marginColour(r.marginPct)}`}>
                    {r.marginPct == null ? '—' : r.marginPct.toFixed(1) + '%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* By Category */}
        {tab === 'categories' && (
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">COGS</th>
                <th className="px-4 py-3 font-medium text-right">Gross Profit</th>
                <th className="px-4 py-3 font-medium text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[#999]">No data.</td></tr>
              ) : categories.map((c, idx) => (
                <tr key={c.categoryId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-2.5 text-[#666] text-xs">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-white text-sm">{c.categoryName}</td>
                  <td className="px-4 py-2.5 text-right text-[#999] text-xs">{c.quantity}×</td>
                  <td className="px-4 py-2.5 text-right text-white text-xs">{formatCurrency(Number(c.revenue))}</td>
                  <td className="px-4 py-2.5 text-right text-[#FFA726] text-xs">{formatCurrency(Number(c.cogs))}</td>
                  <td className="px-4 py-2.5 text-right text-green-500 text-xs">{formatCurrency(Number(c.grossProfit))}</td>
                  <td className={`px-4 py-2.5 text-right text-xs font-medium ${marginColour(c.marginPct)}`}>
                    {c.marginPct == null ? '—' : c.marginPct.toFixed(1) + '%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Inventory Price Volatility — costs below are PER PURCHASE
            UNIT (PACK / BOTTLE / KG bag), not per stock unit. The
            small grey row beneath the latest cost shows the derived
            per-stock-unit price when the two units differ, so admin
            can sanity-check both views at once. */}
        {tab === 'volatility' && (
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Ingredient</th>
                <th className="px-4 py-3 font-medium">Per Unit</th>
                <th className="px-4 py-3 font-medium text-right">Deliveries</th>
                <th className="px-4 py-3 font-medium text-right">Min</th>
                <th className="px-4 py-3 font-medium text-right">Avg</th>
                <th className="px-4 py-3 font-medium text-right">Max</th>
                <th className="px-4 py-3 font-medium text-right">Latest</th>
                <th className="px-4 py-3 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {volatility.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[#999]">All ingredients delivered at a single price in this range.</td></tr>
              ) : volatility.map((v, idx) => {
                const latest = Number(v.latestUnitCost);
                const avg = Number(v.avgUnitCost);
                const trendUp = avg > 0 && latest > avg * 1.05;
                const trendDown = avg > 0 && latest < avg * 0.95;
                // Prefer the new explicit fields; fall back to the
                // legacy `unit` for any cached bundle that hasn't
                // reloaded yet.
                const purchaseUnit = (v as any).purchaseUnit ?? v.unit;
                const stockUnit = (v as any).stockUnit ?? v.unit;
                const purchaseUnitQty = Number((v as any).purchaseUnitQty ?? 1) || 1;
                const showStockHint = stockUnit && purchaseUnit && stockUnit.toUpperCase() !== purchaseUnit.toUpperCase() && purchaseUnitQty > 0;
                const latestPerStock = showStockHint ? latest / purchaseUnitQty : null;
                return (
                  <tr key={v.ingredientId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-2.5 text-[#666] text-xs">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-white text-sm">{v.ingredientName}</td>
                    <td className="px-4 py-2.5 text-[#999] text-xs">
                      {purchaseUnit}
                      {showStockHint && (
                        <span className="block text-[10px] text-[#666] mt-0.5">= {purchaseUnitQty} {stockUnit}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{v.deliveries}</td>
                    <td className="px-4 py-2.5 text-right text-green-500 text-xs">{formatCurrency(Number(v.minUnitCost))}</td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{formatCurrency(avg)}</td>
                    <td className="px-4 py-2.5 text-right text-[#D62B2B] text-xs">{formatCurrency(Number(v.maxUnitCost))}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-white text-xs font-medium">{formatCurrency(latest)}</span>
                      {latestPerStock !== null && (
                        <span className="block text-[10px] text-[#666] mt-0.5">
                          {formatCurrency(latestPerStock)} / {stockUnit}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {trendUp ? <span className="inline-flex items-center gap-1 text-[#D62B2B] text-xs"><TrendingUp size={12} /> Up</span>
                        : trendDown ? <span className="inline-flex items-center gap-1 text-green-500 text-xs"><TrendingDown size={12} /> Down</span>
                        : <span className="text-[#666] text-xs">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
