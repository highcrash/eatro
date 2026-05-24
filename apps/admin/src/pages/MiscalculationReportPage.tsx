import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import type { MiscalculationReport } from '@restora/types';

/**
 * Per-ingredient roll-up of ADJUSTMENT stockMovements whose notes
 * start with "Miscalculation:" — the prefix written by the shopping
 * request approve flow when staff flagged a row as MISCALCULATION.
 * Surfaces chronic shrinkage so admin can spot which ingredients
 * keep counting wrong and tighten habits.
 *
 * Signed quantity: positive = overage (admin's count was lower than
 * physical), negative = shortage. Value is always positive
 * (qty × cost) because shrinkage cost regardless of sign.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

export default function MiscalculationReportPage() {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());

  const { data, isLoading } = useQuery<MiscalculationReport>({
    queryKey: ['miscalculation-report', from, to],
    queryFn: () => api.get<MiscalculationReport>(`/reports/miscalculation?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-white tracking-widest">MISCALCULATION REPORT</h1>
        <p className="text-xs text-[#999] mt-1">
          Ingredients tagged as MISCALCULATION at shopping-request approval, rolled up over the selected window.
        </p>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] p-3 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#888] mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#888] mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
        </div>
        <div className="flex-1" />
        {data && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-[#888]">Total shrinkage value</p>
            <p className="font-display text-2xl text-[#D62B2B]">{formatCurrency(data.totalValuePaisa)}</p>
          </div>
        )}
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#2A2A2A]">
              {['Ingredient', 'Unit', 'Signed qty', 'Events', 'Value'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#666] text-sm">Loading…</td></tr>}
            {!isLoading && data && data.rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#666] text-sm">No miscalculations in this window.</td></tr>
            )}
            {data?.rows.map((row) => (
              <tr key={row.ingredientId} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                <td className="px-4 py-3 text-white font-body text-sm">{row.ingredientName}</td>
                <td className="px-4 py-3 text-[#999] font-body text-xs uppercase">{row.unit}</td>
                <td className={`px-4 py-3 font-body text-sm font-medium ${row.signedQty < 0 ? 'text-[#D62B2B]' : 'text-[#4CAF50]'}`}>
                  {row.signedQty > 0 ? '+' : ''}{row.signedQty.toFixed(2)} {row.unit}
                </td>
                <td className="px-4 py-3 text-[#ccc] font-body text-sm">{row.count}</td>
                <td className="px-4 py-3 text-[#D62B2B] font-body text-sm font-medium">{formatCurrency(row.valuePaisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
