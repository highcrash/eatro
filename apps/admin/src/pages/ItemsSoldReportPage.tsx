import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import type { ItemsSoldReport } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

export default function ItemsSoldReportPage() {
  const today = new Date().toISOString().split('T')[0];
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useQuery<ItemsSoldReport>({
    queryKey: ['items-sold', from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get<ItemsSoldReport>(`/reports/items-sold?${params.toString()}`);
    },
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { quantity: 0, revenue: 0 };

  const handlePrint = () => {
    const lines = rows.map((r, idx) => `<tr>
      <td>${idx + 1}</td><td>${r.name}</td>
      <td class="r">${r.quantity}</td>
      <td class="r">${formatCurrency(Number(r.unitPrice))}</td>
      <td class="r">${formatCurrency(Number(r.totalRevenue))}</td>
    </tr>`).join('');
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(`<html><head><title>Items Sold</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#111;padding:24px}
      h1{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:2px;margin-bottom:4px}.meta{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;border-bottom:1px solid #DDD;padding:6px 4px}
      td{padding:5px 4px;border-bottom:1px solid #F2F1EE;font-size:10px}.r{text-align:right}.t td{border-top:2px solid #111;font-weight:700;padding-top:8px;font-size:11px}
      @media print{body{padding:8mm}}
    </style></head><body>
      <h1>ITEMS SOLD</h1>
      <div class="meta">${rows.length} rows | From: ${from} To: ${to}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Total</th></tr></thead>
      <tbody>${lines}<tr class="t"><td colspan="2">GRAND TOTAL</td><td class="r">${totals.quantity}</td><td></td><td class="r">${formatCurrency(Number(totals.revenue))}</td></tr></tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Reports</p>
          <h1 className="font-display text-4xl text-white tracking-wide">ITEMS SOLD</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-body text-[#999]">{rows.length} rows</span>
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
          {(from !== today || to !== today) && (
            <button onClick={() => { setFrom(today); setTo(today); }}
              className="text-[10px] font-body text-[#D62B2B] hover:underline tracking-widest uppercase">Reset to today</button>
          )}
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium text-right">Unit Price</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#999]">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#999]">No items sold in this range</td></tr>
            ) : (
              <>
                {rows.map((r, idx) => (
                  <tr key={`${r.menuItemId}-${r.unitPrice}`} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-2.5 text-[#666] text-xs">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-white text-sm">{r.name}</td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{r.quantity}×</td>
                    <td className="px-4 py-2.5 text-right text-[#999] text-xs">{formatCurrency(Number(r.unitPrice))}</td>
                    <td className="px-4 py-2.5 text-right text-white font-medium text-xs">{formatCurrency(Number(r.totalRevenue))}</td>
                  </tr>
                ))}
                <tr className="bg-[#0D0D0D]">
                  <td colSpan={2} className="px-4 py-3 text-xs font-body font-medium text-white tracking-widest uppercase">Grand Total</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-white">{totals.quantity}×</td>
                  <td></td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-[#D62B2B] font-display text-base tracking-wide">{formatCurrency(Number(totals.revenue))}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
