import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface VoidedItem {
  id: string;
  orderId: string;
  orderNumber: string;
  tableNumber: string | null;
  type: string;
  orderStatus: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
}

interface VoidedOrder {
  id: string;
  orderNumber: string;
  tableNumber: string | null;
  type: string;
  subtotal: number;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
}

interface VoidReport {
  from: string;
  to: string;
  items: VoidedItem[];
  orders: VoidedOrder[];
  summary: {
    itemCount: number;
    orderCount: number;
    itemsValuePaisa: number;
    ordersValuePaisa: number;
    totalValuePaisa: number;
    byApprover: Array<{ name: string; itemCount: number; orderCount: number; valuePaisa: number }>;
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function VoidReportPage() {
  const [from, setFrom] = useState<string>(today());
  const [to, setTo] = useState<string>(today());

  const { data, isLoading } = useQuery<VoidReport>({
    queryKey: ['void-report', from, to],
    queryFn: () => api.get(`/reports/voids?from=${from}&to=${to}`),
  });

  const summary = data?.summary;
  const items = data?.items ?? [];
  const orders = data?.orders ?? [];

  const formatTime = useMemo(() => (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
  }, []);

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Audit</p>
        <h1 className="font-display text-4xl text-white tracking-wide">VOID REPORT</h1>
        <p className="text-[#666] font-body text-xs mt-2">Items and orders voided by cashiers, with reason and approver. Pull up any suspicious day when the day-end cash doesn't reconcile.</p>
      </div>

      {/* Date range */}
      <div className="bg-[#161616] border border-[#2A2A2A] px-5 py-4 flex items-center gap-4 flex-wrap">
        <label className="text-xs font-body tracking-widest uppercase text-[#999]">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
        />
        <label className="text-xs font-body tracking-widest uppercase text-[#999]">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
        />
        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => { const d = today(); setFrom(d); setTo(d); }}
            className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase"
          >
            Today
          </button>
          <button
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), 1);
              setFrom(start.toISOString().slice(0, 10));
              setTo(today());
            }}
            className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase"
          >
            This Month
          </button>
        </div>
      </div>

      {isLoading && <p className="text-[#999] font-body text-sm">Loading…</p>}

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Voided Items" value={String(summary.itemCount)} sub={formatCurrency(summary.itemsValuePaisa)} />
          <StatCard label="Voided Orders" value={String(summary.orderCount)} sub={formatCurrency(summary.ordersValuePaisa)} />
          <StatCard label="Total Voided Value" value={formatCurrency(summary.totalValuePaisa)} sub={`${summary.itemCount + summary.orderCount} events`} accent />
        </div>
      )}

      {summary && summary.byApprover.length > 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <div className="px-5 py-4 border-b border-[#2A2A2A]">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">By Approver</p>
          </div>
          <table className="w-full font-body text-sm">
            <thead>
              <tr className="text-left text-xs text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-5 py-2 font-medium text-right">Items</th>
                <th className="px-5 py-2 font-medium text-right">Orders</th>
                <th className="px-5 py-2 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {summary.byApprover.map((a) => (
                <tr key={a.name} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-5 py-2 text-white">{a.name}</td>
                  <td className="px-5 py-2 text-[#999] text-right">{a.itemCount}</td>
                  <td className="px-5 py-2 text-[#999] text-right">{a.orderCount}</td>
                  <td className="px-5 py-2 text-[#D62B2B] text-right">{formatCurrency(a.valuePaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Voided Items ({items.length})</p>
        </div>
        <table className="w-full font-body text-sm">
          <thead>
            <tr className="text-left text-xs text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Order</th>
              <th className="px-5 py-3 font-medium">Item</th>
              <th className="px-5 py-3 font-medium text-right">Qty</th>
              <th className="px-5 py-3 font-medium text-right">Value</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Approver</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-5 py-3 text-[#999]">{formatTime(i.voidedAt)}</td>
                <td className="px-5 py-3 text-[#DDD9D3]">
                  <span className="font-mono text-xs">{i.orderNumber}</span>
                  {i.tableNumber && <span className="text-[#666] ml-2">T{i.tableNumber}</span>}
                </td>
                <td className="px-5 py-3 text-white">{i.menuItemName}</td>
                <td className="px-5 py-3 text-[#999] text-right">{i.quantity}</td>
                <td className="px-5 py-3 text-[#D62B2B] text-right">{formatCurrency(i.lineTotal)}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{i.voidReason ?? '—'}</td>
                <td className="px-5 py-3 text-[#999]">{i.voidedBy?.name ?? '—'}</td>
              </tr>
            ))}
            {items.length === 0 && !isLoading && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-[#666]">No item voids in this range</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Voided Orders ({orders.length})</p>
        </div>
        <table className="w-full font-body text-sm">
          <thead>
            <tr className="text-left text-xs text-[#666] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Order</th>
              <th className="px-5 py-3 font-medium">Table / Type</th>
              <th className="px-5 py-3 font-medium text-right">Subtotal</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Approver</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-5 py-3 text-[#999]">{formatTime(o.voidedAt)}</td>
                <td className="px-5 py-3 text-[#DDD9D3] font-mono text-xs">{o.orderNumber}</td>
                <td className="px-5 py-3 text-[#999]">{o.tableNumber ? `T${o.tableNumber}` : o.type}</td>
                <td className="px-5 py-3 text-[#D62B2B] text-right">{formatCurrency(o.subtotal)}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{o.voidReason ?? '—'}</td>
                <td className="px-5 py-3 text-[#999]">{o.voidedBy?.name ?? '—'}</td>
              </tr>
            ))}
            {orders.length === 0 && !isLoading && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-[#666]">No full-order voids in this range</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`bg-[#161616] border ${accent ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'} p-5`}>
      <p className="text-[10px] font-body tracking-widest uppercase text-[#999] mb-2">{label}</p>
      <p className={`font-display text-3xl tracking-wide ${accent ? 'text-[#D62B2B]' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] font-body text-[#666] mt-1">{sub}</p>}
    </div>
  );
}
