import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface AggregatorRow {
  platformCode: string;
  platformName: string;
  platformColor: string | null;
  accountId: string | null;
  creditorId: string | null;
  creditorName: string | null;
  orders: number;
  grossPaisa: number;
  feesPaisa: number;
  netPaisa: number;
  outstandingPaisa: number;
}

interface AggregatorPnLResponse {
  from: string;
  to: string;
  rows: AggregatorRow[];
  totals: {
    orders: number;
    grossPaisa: number;
    feesPaisa: number;
    netPaisa: number;
    outstandingPaisa: number;
  };
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregator P&L — per-platform gross-vs-net for Foodpanda / Foodie /
 * Pathao Food and any other food-delivery aggregator the admin has
 * configured under the FOOD_DELIVERY payment category. Gross comes
 * from orders paid via the platform's PaymentOption. Fees come from
 * CreditorBill rows recorded against the matching creditor (name-
 * matched, case-insensitive). Net = gross − fees.
 *
 * Negative net (the situation in Eatro's 15 May Foodpanda invoice
 * where commission + VAT + subscription exceeded gross revenue)
 * shows up in red so owners notice the problem.
 */
export default function AggregatorPnLPage() {
  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const [from, setFrom] = useState(toDateStr(monthStart));
  const [to, setTo] = useState(toDateStr(today));

  const { data, isLoading, error } = useQuery<AggregatorPnLResponse>({
    queryKey: ['aggregator-pnl', from, to],
    queryFn: () => api.get(`/reports/aggregator-pnl?from=${from}&to=${to}`),
  });

  const setPreset = (kind: 'mtd' | 'last7' | 'last30') => {
    const now = new Date();
    if (kind === 'mtd') {
      setFrom(toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(toDateStr(now));
    } else if (kind === 'last7') {
      const f = new Date(now); f.setDate(now.getDate() - 6);
      setFrom(toDateStr(f));
      setTo(toDateStr(now));
    } else {
      const f = new Date(now); f.setDate(now.getDate() - 29);
      setFrom(toDateStr(f));
      setTo(toDateStr(now));
    }
  };

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">AGGREGATOR P&amp;L</h1>
          <p className="text-xs text-[#999] mt-1">
            Per-platform gross-vs-net for food-delivery aggregators (Foodpanda, Foodie, Pathao Food, etc.).
            Fees come from CreditorBills recorded against the matching creditor in the period.
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-[#666]" />
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white text-sm font-body px-3 py-1.5 focus:outline-none focus:border-[#D62B2B]"
          />
          <span className="text-[#666] text-xs">to</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white text-sm font-body px-3 py-1.5 focus:outline-none focus:border-[#D62B2B]"
          />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPreset('mtd')} className="text-[10px] uppercase tracking-widest text-[#999] hover:text-white border border-[#2A2A2A] px-2 py-1">MTD</button>
          <button onClick={() => setPreset('last7')} className="text-[10px] uppercase tracking-widest text-[#999] hover:text-white border border-[#2A2A2A] px-2 py-1">7d</button>
          <button onClick={() => setPreset('last30')} className="text-[10px] uppercase tracking-widest text-[#999] hover:text-white border border-[#2A2A2A] px-2 py-1">30d</button>
        </div>
      </div>

      {/* Setup hint when no platforms have been configured. */}
      {data && data.rows.length === 0 && !isLoading && (
        <div className="border border-[#2A2A2A] p-6 text-sm text-[#999] space-y-2">
          <p className="text-white font-medium">No delivery platforms configured.</p>
          <p>
            To start tracking Foodpanda / Foodie / Pathao Food revenue here:
          </p>
          <ol className="list-decimal ml-5 space-y-1 text-xs">
            <li>Go to <span className="text-[#FFA726]">Settings → Payment Methods</span> and create a <code className="text-[#FFA726]">FOOD_DELIVERY</code> category.</li>
            <li>Under it, add one PaymentOption per platform (code e.g. <code>FOOD_PANDA</code>, <code>FOODIE</code>, <code>PATHAO_FOOD</code>).</li>
            <li>(Optional but recommended) Link each option to a "Pending Settlement" Account so gross revenue posts there.</li>
            <li>Create a Creditor named after each platform (e.g. "Foodpanda Bangladesh Ltd"). Record their weekly invoice as a CreditorBill — fees appear here automatically.</li>
          </ol>
        </div>
      )}

      {/* Top tiles. */}
      {totals && data && data.rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Orders" value={String(totals.orders)} sub={`across ${data.rows.length} platform(s)`} />
          <Tile label="Gross revenue" value={formatCurrency(totals.grossPaisa)} sub="from delivery orders" />
          <Tile
            label="Platform fees"
            value={formatCurrency(totals.feesPaisa)}
            sub="commission + VAT + subscription"
            color="#FFA726"
          />
          <Tile
            label="Net take-home"
            value={formatCurrency(totals.netPaisa)}
            sub={totals.netPaisa < 0 ? '⚠ Negative — fees exceed gross' : 'gross − fees'}
            color={totals.netPaisa < 0 ? '#D62B2B' : '#4CAF50'}
          />
        </div>
      )}

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}
      {error && <p className="text-[#D62B2B] text-sm">Failed to load: {(error as Error).message}</p>}

      {data && data.rows.length > 0 && (
        <div className="border border-[#2A2A2A] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] bg-[#161616]">
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3 text-right">Orders</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Fees</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Setup</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const negative = r.netPaisa < 0;
                const marginPct = r.grossPaisa > 0 ? (r.netPaisa / r.grossPaisa) * 100 : null;
                return (
                  <tr key={r.platformCode} className="border-t border-[#2A2A2A] hover:bg-[#161616]">
                    <td className="px-4 py-3 text-white">
                      <p className="font-medium flex items-center gap-2">
                        {r.platformColor && (
                          <span
                            className="w-2 h-2 inline-block rounded-sm"
                            style={{ backgroundColor: r.platformColor }}
                            aria-hidden
                          />
                        )}
                        {r.platformName}
                      </p>
                      <p className="text-[10px] font-mono text-[#666]">{r.platformCode}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-[#DDD9D3]">{r.orders}</td>
                    <td className="px-4 py-3 text-right text-[#DDD9D3]">{formatCurrency(r.grossPaisa)}</td>
                    <td className="px-4 py-3 text-right text-[#FFA726]">{formatCurrency(r.feesPaisa)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${negative ? 'text-[#D62B2B]' : 'text-[#4CAF50]'}`}>
                      {formatCurrency(r.netPaisa)}
                      {marginPct !== null && (
                        <span className="block text-[10px] text-[#666] font-normal">
                          {marginPct.toFixed(1)}% margin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#999]">
                      {r.accountId ? formatCurrency(r.outstandingPaisa) : <span className="text-[#666]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[10px]">
                      {!r.accountId && (
                        <span className="text-[#FFA726] flex items-center gap-1">
                          <AlertTriangle size={10} /> no account
                        </span>
                      )}
                      {!r.creditorId && (
                        <span className="text-[#FFA726] flex items-center gap-1">
                          <AlertTriangle size={10} /> no creditor
                        </span>
                      )}
                      {r.accountId && r.creditorId && (
                        <span className="text-[#4CAF50]">✓ wired</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-[#444] bg-[#161616] font-medium">
                <td className="px-4 py-3 text-white text-[10px] uppercase tracking-widest">Total</td>
                <td className="px-4 py-3 text-right text-[#DDD9D3]">{totals?.orders ?? 0}</td>
                <td className="px-4 py-3 text-right text-[#DDD9D3]">{formatCurrency(totals?.grossPaisa ?? 0)}</td>
                <td className="px-4 py-3 text-right text-[#FFA726]">{formatCurrency(totals?.feesPaisa ?? 0)}</td>
                <td className={`px-4 py-3 text-right ${(totals?.netPaisa ?? 0) < 0 ? 'text-[#D62B2B]' : 'text-[#4CAF50]'}`}>
                  {formatCurrency(totals?.netPaisa ?? 0)}
                </td>
                <td className="px-4 py-3 text-right text-[#999]">{formatCurrency(totals?.outstandingPaisa ?? 0)}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Workflow hint. */}
      {data && data.rows.length > 0 && (
        <div className="border border-[#2A2A2A] bg-[#0d0d0d] p-4 text-[11px] text-[#666] space-y-1">
          <p className="text-[#999] text-xs font-medium">How fees are tracked</p>
          <p>
            Every week (or whenever an aggregator sends an invoice / settlement statement), record it in
            <span className="text-[#FFA726]"> Liabilities → Creditors → [Platform] → + Bill</span> with the
            commission, VAT, subscription, and online-payment-charge as individual line items. Settle via
            <span className="text-[#FFA726]"> + Payment </span> when the platform transfers the net to your bank.
            The Outstanding column above is the balance of the platform's Pending Settlement account — it should
            trend toward zero after each settlement.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="border border-[#2A2A2A] bg-[#161616] p-4">
      <p className="text-[10px] uppercase tracking-widest text-[#888]">{label}</p>
      <p className="text-xl font-medium mt-1" style={{ color: color ?? '#FFFFFF' }}>{value}</p>
      {sub && <p className="text-[10px] text-[#666] mt-1">{sub}</p>}
    </div>
  );
}
