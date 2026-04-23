import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileDown } from 'lucide-react';
import type { MushakRegisterRow } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

type Filter = 'all' | 'invoice' | 'note';

/**
 * Mushak-9.1 equivalent sales register. Shows every 6.3 (invoice) and 6.8
 * (credit note) for a date range with running totals per VAT bucket.
 * Admins export CSV for their accountant or print the HTML for audit.
 */
export default function MushakRegisterPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [filter, setFilter] = useState<Filter>('all');

  const { data: rows = [], isLoading } = useQuery<MushakRegisterRow[]>({
    queryKey: ['mushak-register', from, to, filter],
    queryFn: () => api.get(`/mushak/register?from=${from}&to=${to}&filter=${filter}`),
  });

  const totals = useMemo(() => {
    let subtotal = 0, sd = 0, vat = 0, total = 0, invoices = 0, notes = 0;
    for (const r of rows) {
      subtotal += Number(r.subtotalExclVat);
      sd += Number(r.sdAmount);
      vat += Number(r.vatAmount);
      total += Number(r.totalInclVat);
      if (r.kind === 'INVOICE') invoices += 1; else notes += 1;
    }
    return { subtotal, sd, vat, total, invoices, notes };
  }, [rows]);

  const exportCsv = () => {
    // Route the token-auth'd CSV through a temporary <a> using the api helper
    // to keep the Bearer header. Admin base URL already handles auth.
    const url = `/api/v1/mushak/register.csv?from=${from}&to=${to}`;
    // api.ts wraps fetch with auth, so we bounce through a blob.
    void api.get<string>(url.replace(/^\/api\/v1/, '')).then((csv) => {
      const blob = new Blob([csv as unknown as string], { type: 'text/csv' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `mushak-register-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    });
  };

  const printRegister = () => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    const escape = (s: string | number | null | undefined) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Totals come in paisa (Order table stores smallest unit); convert for display.
    const money = (n: number) => formatCurrency(n);
    const rowsHtml = rows.map((r) => `<tr>
      <td>${escape(r.kind)}</td>
      <td style="font-family:monospace">${escape(r.serial)}</td>
      <td>${escape(new Date(r.issuedAt).toLocaleString('en-GB'))}</td>
      <td>${escape(r.buyerName ?? 'Walk-in')}</td>
      <td>${r.linkedInvoiceSerial ? escape(r.linkedInvoiceSerial) : ''}</td>
      <td>${r.reasonCode ? escape(r.reasonCode) : ''}</td>
      <td style="text-align:right">${money(Number(r.subtotalExclVat))}</td>
      <td style="text-align:right">${money(Number(r.sdAmount))}</td>
      <td style="text-align:right">${money(Number(r.vatAmount))}</td>
      <td style="text-align:right;font-weight:bold">${money(Number(r.totalInclVat))}</td>
    </tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Mushak Register ${from} – ${to}</title>
      <style>
        body { font-family: -apple-system, Arial, sans-serif; padding: 20px; color: #000; }
        h1 { margin: 0 0 4px; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
        th { text-align: left; background: #eee; padding: 6px 8px; border-bottom: 2px solid #000; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
        td { padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 12px; }
        tfoot td { font-weight: bold; border-top: 2px solid #000; padding-top: 8px; }
      </style></head><body>
        <h1>Mushak Sales Register</h1>
        <div style="color:#666">Period: ${from} – ${to} · ${totals.invoices} invoices · ${totals.notes} credit notes</div>
        <table>
          <thead><tr>
            <th>Type</th><th>Serial</th><th>Date/Time</th><th>Buyer</th><th>Ref</th><th>Reason</th>
            <th style="text-align:right">Subtotal</th><th style="text-align:right">SD</th>
            <th style="text-align:right">VAT</th><th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr>
            <td colspan="6" style="text-align:right">Totals</td>
            <td style="text-align:right">${money(totals.subtotal)}</td>
            <td style="text-align:right">${money(totals.sd)}</td>
            <td style="text-align:right">${money(totals.vat)}</td>
            <td style="text-align:right">${money(totals.total)}</td>
          </tr></tfoot>
        </table>
        <script>window.onload=function(){window.print();}<\/script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">NBR Compliance</p>
        <h1 className="font-display text-4xl text-white tracking-wide">MUSHAK REGISTER</h1>
        <p className="text-xs text-[#999] font-body mt-1">Sales register (Mushak-9.1 equivalent) — 6.3 invoices and 6.8 credit notes for the selected period.</p>
      </div>

      <div className="flex flex-wrap items-end gap-4 bg-[#161616] border border-[#2A2A2A] p-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] tracking-widest uppercase text-[#666] font-body">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] tracking-widest uppercase text-[#666] font-body">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B]" />
        </div>
        <div className="flex items-stretch gap-0 border border-[#2A2A2A]">
          {(['all', 'invoice', 'note'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs font-body tracking-widest uppercase transition-colors ${filter === f ? 'bg-[#D62B2B] text-white' : 'text-[#999] hover:text-white'}`}>
              {f === 'all' ? 'All' : f === 'invoice' ? '6.3 only' : '6.8 only'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body tracking-widest uppercase hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors">
            <FileDown size={14} /> CSV
          </button>
          <button onClick={printRegister}
            className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-3 py-2 text-xs font-body tracking-widest uppercase hover:bg-[#F03535] transition-colors">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] tracking-widest uppercase text-[#666] font-body bg-[#0D0D0D] border-b border-[#2A2A2A]">
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Buyer</th>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2 text-right">SD</th>
              <th className="px-3 py-2 text-right">VAT</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-[#666] font-body text-sm">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-[#666] font-body text-sm">No Mushak documents in this period.</td></tr>
            )}
            {rows.map((r) => {
              const isNote = r.kind === 'NOTE';
              const route = isNote ? `/mushak/notes/${r.id}` : `/mushak/invoices/${r.id}`;
              const tone = isNote ? 'text-[#E57373]' : 'text-white';
              return (
                <tr key={r.id} className="border-b border-[#2A2A2A] hover:bg-[#0D0D0D]">
                  <td className={`px-3 py-2 font-body text-xs ${isNote ? 'text-[#E57373]' : 'text-[#4CAF50]'}`}>{isNote ? '6.8' : '6.3'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <a href={route} target="_blank" rel="noopener noreferrer" className="text-[#FFA726] hover:text-white transition-colors">
                      {r.serial}
                    </a>
                  </td>
                  <td className="px-3 py-2 font-body text-xs text-[#999]">{new Date(r.issuedAt).toLocaleString('en-GB')}</td>
                  <td className="px-3 py-2 font-body text-xs text-[#999]">{r.buyerName ?? 'Walk-in'}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#666]">{r.linkedInvoiceSerial ?? ''}</td>
                  <td className="px-3 py-2 font-body text-xs text-[#666]">{r.reasonCode ?? ''}</td>
                  <td className={`px-3 py-2 font-body text-xs text-right ${tone}`}>{formatCurrency(Number(r.subtotalExclVat))}</td>
                  <td className={`px-3 py-2 font-body text-xs text-right ${tone}`}>{formatCurrency(Number(r.sdAmount))}</td>
                  <td className={`px-3 py-2 font-body text-xs text-right ${tone}`}>{formatCurrency(Number(r.vatAmount))}</td>
                  <td className={`px-3 py-2 font-body text-sm text-right font-bold ${tone}`}>{formatCurrency(Number(r.totalInclVat))}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-[#0D0D0D] border-t-2 border-[#2A2A2A]">
                <td colSpan={6} className="px-3 py-3 text-right text-[#666] font-body text-xs tracking-widest uppercase">Totals</td>
                <td className="px-3 py-3 text-right text-white font-body text-sm font-bold">{formatCurrency(totals.subtotal)}</td>
                <td className="px-3 py-3 text-right text-white font-body text-sm font-bold">{formatCurrency(totals.sd)}</td>
                <td className="px-3 py-3 text-right text-white font-body text-sm font-bold">{formatCurrency(totals.vat)}</td>
                <td className="px-3 py-3 text-right text-[#D62B2B] font-display text-base">{formatCurrency(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
