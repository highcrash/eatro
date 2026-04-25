import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import type { SuppliesReportResponse } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

/**
 * Supplies report — non-recipe operational stock (parcel bags,
 * tissues, cleaner, plates) over a date window. Shows purchase spend,
 * manual usage (the OPERATIONAL_USE log), waste, on-hand value, and a
 * trailing 30-day burn rate so owners can see days-of-cover and total
 * monthly consumables spend separately from food cost.
 */
export default function SuppliesReportPage() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = (() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  })();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useQuery<SuppliesReportResponse>({
    queryKey: ['supplies-report', from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get<SuppliesReportResponse>(`/reports/supplies?${params.toString()}`);
    },
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { purchasedCost: 0, usedQty: 0, onHandValue: 0 };

  const handlePrint = () => {
    const lines = rows.map((r, idx) => `<tr>
      <td>${idx + 1}</td>
      <td>${r.name}</td>
      <td class="r">${r.purchasedQty.toFixed(2)} ${r.unit}</td>
      <td class="r">${formatCurrency(r.purchasedCost)}</td>
      <td class="r">${r.usedQty.toFixed(2)} ${r.unit}</td>
      <td class="r">${r.wastedQty.toFixed(2)}</td>
      <td class="r">${r.currentStock.toFixed(2)}</td>
      <td class="r">${formatCurrency(r.onHandValue)}</td>
      <td class="r">${r.daysOfCover === null ? '—' : Math.round(r.daysOfCover) + 'd'}</td>
    </tr>`).join('');
    const win = window.open('', '_blank', 'width=1100,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Supplies Report</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#111;padding:24px}
      h1{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:2px;margin-bottom:4px}.meta{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:6px 4px}
      td{padding:5px 4px;border-bottom:1px solid #F2F1EE;font-size:10px}.r{text-align:right}.t td{border-top:2px solid #111;font-weight:700;padding-top:8px;font-size:11px}
      @media print{body{padding:8mm}}
    </style></head><body>
      <h1>SUPPLIES REPORT</h1>
      <div class="meta">${rows.length} items | From: ${from} To: ${to}</div>
      <table><thead><tr>
        <th>#</th><th>Supply</th>
        <th class="r">Purchased</th><th class="r">Spend</th>
        <th class="r">Used</th><th class="r">Wasted</th>
        <th class="r">On-hand</th><th class="r">Value</th>
        <th class="r">Cover</th>
      </tr></thead>
      <tbody>${lines}<tr class="t">
        <td colspan="3">GRAND TOTAL</td>
        <td class="r">${formatCurrency(totals.purchasedCost)}</td>
        <td class="r">${totals.usedQty.toFixed(2)}</td>
        <td></td><td></td>
        <td class="r">${formatCurrency(totals.onHandValue)}</td>
        <td></td>
      </tr></tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
  };

  const handleCsv = () => {
    const headers = ['name', 'unit', 'purchasedQty', 'purchasedCost', 'usedQty', 'wastedQty', 'currentStock', 'onHandValue', 'avgDailyUsage', 'daysOfCover'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      csvRows.push([
        `"${r.name.replace(/"/g, '""')}"`,
        r.unit,
        r.purchasedQty.toFixed(3),
        (r.purchasedCost / 100).toFixed(2),
        r.usedQty.toFixed(3),
        r.wastedQty.toFixed(3),
        r.currentStock.toFixed(3),
        (r.onHandValue / 100).toFixed(2),
        r.avgDailyUsage.toFixed(3),
        r.daysOfCover === null ? '' : r.daysOfCover.toFixed(1),
      ].join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supplies-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Reports</p>
          <h1 className="font-display text-4xl text-white tracking-wide">SUPPLIES</h1>
          <p className="text-xs font-body text-[#666] mt-1">Non-recipe operational stock — tissues, parcel bags, cleaner, plates</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-body text-[#999]">{rows.length} items</span>
          <button onClick={handleCsv} className="flex items-center gap-1.5 border border-[#2A2A2A] px-3 py-1.5 text-xs font-body text-[#999] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors">
            CSV
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 border border-[#2A2A2A] px-3 py-1.5 text-xs font-body text-[#999] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors">
            <Printer size={12} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
            <span className="text-[10px] font-body text-[#666] tracking-widest uppercase">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[#0D0D0D] border border-[#2A2A2A] px-2 py-1.5 text-xs font-body text-white outline-none focus:border-[#D62B2B]" />
          </div>
          {(from !== monthStart || to !== today) && (
            <button onClick={() => { setFrom(monthStart); setTo(today); }}
              className="text-[10px] font-body text-[#D62B2B] hover:underline tracking-widest uppercase">Reset to MTD</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Purchased</p>
          <p className="font-display text-white text-3xl">{formatCurrency(totals.purchasedCost)}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Used (qty)</p>
          <p className="font-display text-[#FFA726] text-3xl">{totals.usedQty.toFixed(0)}</p>
        </div>
        <div className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">On-hand value</p>
          <p className="font-display text-[#4CAF50] text-3xl">{formatCurrency(totals.onHandValue)}</p>
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Supply</th>
              <th className="px-4 py-3 font-medium text-right">Purchased</th>
              <th className="px-4 py-3 font-medium text-right">Spend</th>
              <th className="px-4 py-3 font-medium text-right">Used</th>
              <th className="px-4 py-3 font-medium text-right">Wasted</th>
              <th className="px-4 py-3 font-medium text-right">On-hand</th>
              <th className="px-4 py-3 font-medium text-right">Value</th>
              <th className="px-4 py-3 font-medium text-right">Cover</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666]">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666]">
                No supplies on file. Add an ingredient in <span className="text-[#999]">Inventory</span> with category <span className="text-[#FFA726]">SUPPLY</span> (parcel bags, tissues, cleaner) to start tracking.
              </td></tr>
            )}
            {rows.map((r, idx) => (
              <tr key={r.ingredientId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                <td className="px-4 py-3 text-[#666]">{idx + 1}</td>
                <td className="px-4 py-3 text-white">{r.name}</td>
                <td className="px-4 py-3 text-right text-[#999]">{r.purchasedQty.toFixed(2)} <span className="text-[#666] text-[10px]">{r.unit}</span></td>
                <td className="px-4 py-3 text-right text-white">{formatCurrency(r.purchasedCost)}</td>
                <td className="px-4 py-3 text-right text-[#FFA726]">{r.usedQty.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-[#EF5350]">{r.wastedQty > 0 ? r.wastedQty.toFixed(2) : '—'}</td>
                <td className="px-4 py-3 text-right text-white">{r.currentStock.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-[#999]">{formatCurrency(r.onHandValue)}</td>
                <td className={`px-4 py-3 text-right ${r.daysOfCover === null ? 'text-[#666]' : r.daysOfCover < 7 ? 'text-[#D62B2B]' : r.daysOfCover < 14 ? 'text-[#FFA726]' : 'text-[#999]'}`}>
                  {r.daysOfCover === null ? '—' : `${Math.round(r.daysOfCover)}d`}
                </td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="border-t-2 border-[#2A2A2A] bg-[#0D0D0D]">
                <td colSpan={3} className="px-4 py-3 text-white font-display text-base tracking-widest">TOTALS</td>
                <td className="px-4 py-3 text-right text-white font-display text-base">{formatCurrency(totals.purchasedCost)}</td>
                <td className="px-4 py-3 text-right text-[#FFA726] font-display text-base">{totals.usedQty.toFixed(2)}</td>
                <td colSpan={2}></td>
                <td className="px-4 py-3 text-right text-[#4CAF50] font-display text-base">{formatCurrency(totals.onHandValue)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
