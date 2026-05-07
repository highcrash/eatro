import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Search, ChevronDown } from 'lucide-react';

import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

/**
 * Per-ingredient activity ledger. Pick an ingredient + a date range
 * and walk every PURCHASE / SALE / WASTE / ADJUSTMENT event with
 * supplier + order context, qty, and money value.
 *
 * Renders three layers:
 *
 *   1. Header bar — ingredient picker, date-range pickers, Print btn.
 *   2. Summary tiles — purchase / usage / wastage / closing-stock.
 *   3. Day-by-day breakdown — sub-tables per movement bucket.
 *
 * Print stylesheet (`@media print`) hides nav + buttons + form
 * controls and forces black-on-white so Ctrl+P / browser-print
 * produces a clean A4 hardcopy. The desktop POS doesn't need this
 * page; admins drive it from the web admin app.
 */

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  category: string;
  hasVariants?: boolean;
  parentId?: string | null;
  variants?: Ingredient[];
}

interface PurchaseRow {
  time: string;
  type: 'PURCHASE' | 'PRODUCTION_RECEIVED';
  supplierName: string | null;
  poNumber: string | null;
  quantity: number;
  unit: string;
  unitCostPaisa: number;
  totalPaisa: number;
  isApprox: boolean;
  notes: string | null;
  variantName: string | null;
}

interface SaleRow {
  time: string;
  type: 'SALE' | 'OPERATIONAL_USE';
  orderNumber: string | null;
  notes: string | null;
  quantity: number;
  unitCostPaisa: number;
  totalPaisa: number;
  isApprox: boolean;
  variantName: string | null;
}

interface WastageRow {
  time: string;
  kind: 'MANUAL' | 'VOID_AUTO';
  reason: string | null;
  recordedByName: string | null;
  orderNumber: string | null;
  notes: string | null;
  quantity: number;
  unitCostPaisa: number;
  totalPaisa: number;
  isApprox: boolean;
  variantName: string | null;
}

interface OtherRow {
  time: string;
  type: string;
  signedQuantity: number;
  notes: string | null;
  orderNumber: string | null;
  staffName: string | null;
  unitCostPaisa: number;
  totalPaisa: number;
  isApprox: boolean;
  variantName: string | null;
}

interface StockWatcherDay {
  date: string;
  purchases: PurchaseRow[];
  sales: SaleRow[];
  wastage: WastageRow[];
  other: OtherRow[];
}

interface StockWatcherResponse {
  ingredient: {
    id: string;
    name: string;
    unit: string;
    currentStock: number;
    costPerUnit: number;
    hasVariants?: boolean;
    variantCount?: number;
  };
  range: { from: string; to: string };
  summary: {
    openingStockQty: number;
    openingStockValuePaisa: number;
    purchaseQty: number;
    purchaseValuePaisa: number;
    /** Net usage = gross sales/operational deductions minus void
     *  returns. This is the "actually consumed" figure. */
    usageQty: number;
    usageValuePaisa: number;
    /** Gross usage figure before subtracting void returns. */
    usageGrossQty: number;
    usageGrossValuePaisa: number;
    /** Stock returned to shelf when an order was voided. Always
     *  positive; subtracted from gross usage to compute net. */
    voidReturnQty: number;
    voidReturnValuePaisa: number;
    wastageQty: number;
    wastageValuePaisa: number;
    adjustmentQty: number;
    adjustmentValuePaisa: number;
    closingStockQty: number;
    closingStockValuePaisa: number;
  };
  days: StockWatcherDay[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthAgoIso = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  // Input is "YYYY-MM-DD"; render as "01 Apr 2026" so it matches the
  // user's mockup wording without forcing a locale-specific format.
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 1000) / 1000;
  // Strip pointless trailing zeros so "150.000 G" reads as "150 G".
  return `${rounded.toString()} ${unit}`;
}

export default function StockWatcherPage() {
  const [ingredientId, setIngredientId] = useState<string>('');
  const [from, setFrom] = useState<string>(monthAgoIso());
  const [to, setTo] = useState<string>(todayIso());

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients-for-watcher'],
    queryFn: () => api.get<Ingredient[]>('/ingredients'),
  });

  // Default to the first ingredient on load so the page is never
  // blank when admin first lands here.
  const effectiveId = ingredientId || ingredients[0]?.id || '';

  const { data, isLoading, isError, error } = useQuery<StockWatcherResponse | null>({
    queryKey: ['stock-watcher', effectiveId, from, to],
    queryFn: () =>
      api.get<StockWatcherResponse | null>(
        `/reports/stock-watcher?ingredientId=${encodeURIComponent(effectiveId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!effectiveId,
  });

  // Parents-only picker. The server-side `getStockWatcher` already
  // rolls up variants under their parent (PURCHASE / SALE / WASTE
  // movements all hit specific variant rows; the report aggregates
  // them across the family), so the admin never needs to choose a
  // variant explicitly — picking the parent gives the combined
  // view. Sort alphabetically for stable typeahead matching.
  const pickerOptions = useMemo(() => {
    return [...ingredients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const variantCount = Array.isArray(p.variants) ? p.variants.length : 0;
        const label = p.hasVariants && variantCount > 0
          ? `${p.name} (${variantCount} variant${variantCount === 1 ? '' : 's'})`
          : p.name;
        return { id: p.id, name: p.name, label, category: p.category };
      });
  }, [ingredients]);

  // Combobox state — search-as-you-type. Closed by default; opens
  // when the input is focused or the chevron is clicked. Click-
  // outside closes via the document listener below. Filter is a
  // case-insensitive substring match on the label so "spring"
  // matches "Spring Onion (3 variants)" as well as "Karim's Spring
  // Roll Wrapper".
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  const filteredOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerOptions;
    return pickerOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [pickerOptions, pickerQuery]);

  const selectedLabel =
    pickerOptions.find((o) => o.id === effectiveId)?.label ?? '';

  return (
    <div className="space-y-6 stock-watcher-page">
      {/* ── Print styles ─────────────────────────────────────── */}
      <style>{`
        @media print {
          /* Hide everything except the report content. The admin
             layout's sidebar / topbar live outside this page so we
             have to rely on a class hook to skip the form controls
             and the page's print button itself. */
          .no-print { display: none !important; }
          body, html { background: #fff !important; color: #000 !important; }
          .stock-watcher-page { padding: 0 !important; }
          .stock-watcher-page * { color: #000 !important; background: transparent !important; border-color: #999 !important; }
          .sw-tile { border: 1px solid #999; padding: 8px 12px !important; }
          .sw-day { page-break-inside: avoid; }
          .sw-table th, .sw-table td { border: 1px solid #ccc !important; padding: 4px 8px !important; }
          @page { size: A4; margin: 12mm; }
        }
        .sw-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #e6e6e6; }
        .sw-table th { text-align: left; padding: 6px 8px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; background: #161616; }
        .sw-table td { padding: 6px 8px; border-top: 1px solid #2a2a2a; vertical-align: top; color: inherit; }
        .sw-table tbody tr:hover { background: #161616; }
        .sw-table .num { text-align: right; font-variant-numeric: tabular-nums; color: #fff; }
        .sw-table td.num.gain { color: #4CAF50; }
        .sw-table td.num.loss { color: #FFA726; }
        .sw-tile { background: #161616; border: 1px solid #2a2a2a; padding: 16px 20px; }
        .sw-section-label { font-size: 11px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600; margin: 16px 0 6px; }
        .sw-day { border: 1px solid #2a2a2a; background: #0d0d0d; padding: 16px 20px; margin-bottom: 12px; }
        .sw-day-title { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
      `}</style>

      {/* ── Header bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 no-print">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">STOCK WATCHER</h1>
          <p className="text-xs text-[#999] mt-1">Per-ingredient activity ledger over a date range.</p>
        </div>
        <div className="flex-1" />
        <div className="relative" ref={pickerWrapRef}>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">Ingredient</label>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-2 bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm min-w-[280px] hover:border-[#444]"
          >
            <Search size={14} className="text-[#888]" />
            <span className="flex-1 text-left truncate">{selectedLabel || 'Pick an ingredient…'}</span>
            <ChevronDown size={14} className={`text-[#888] transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
          {pickerOpen && (
            <div className="absolute z-20 mt-1 w-[360px] bg-[#0d0d0d] border border-[#2a2a2a] shadow-2xl">
              <div className="border-b border-[#2a2a2a] p-2">
                <input
                  autoFocus
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Type to search…"
                  className="w-full bg-[#161616] border border-[#2a2a2a] text-white text-sm px-2 py-1.5 outline-none focus:border-[#666]"
                  onKeyDown={(e) => {
                    // Enter selects the first match — keeps the
                    // keyboard-only flow snappy.
                    if (e.key === 'Enter' && filteredOptions[0]) {
                      e.preventDefault();
                      setIngredientId(filteredOptions[0].id);
                      setPickerOpen(false);
                      setPickerQuery('');
                    } else if (e.key === 'Escape') {
                      setPickerOpen(false);
                    }
                  }}
                />
              </div>
              <ul className="max-h-72 overflow-auto">
                {filteredOptions.length === 0 && (
                  <li className="px-3 py-2 text-xs text-[#888]">No matches.</li>
                )}
                {filteredOptions.map((o) => {
                  const active = o.id === effectiveId;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setIngredientId(o.id);
                          setPickerOpen(false);
                          setPickerQuery('');
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-[#1f1f1f] ${active ? 'bg-[#1f1f1f] text-white' : 'text-[#ddd]'}`}
                      >
                        <div>{o.label}</div>
                        {o.category && <div className="text-[10px] text-[#888]">{o.category}</div>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-[#2a2a2a] hover:bg-[#D62B2B] text-white px-4 py-2 text-sm transition-colors"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      {isError && (
        <div className="bg-[#3a1a1a] border border-[#D62B2B] text-[#F03535] p-4 text-sm">
          Failed to load: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {data && (
        <>
          {/* ── Header (printable) ─────────────────────────── */}
          <div>
            <p className="font-display text-2xl text-white tracking-widest">
              {data.ingredient.name}
              {data.ingredient.hasVariants && data.ingredient.variantCount ? (
                <span className="text-sm text-[#888] ml-3 tracking-wide">
                  family · {data.ingredient.variantCount} variant{data.ingredient.variantCount === 1 ? '' : 's'} rolled up
                </span>
              ) : null}
            </p>
            <p className="text-xs text-[#999] mt-1">
              {fmtDate(data.range.from.slice(0, 10))} → {fmtDate(data.range.to.slice(0, 10))}
            </p>
          </div>

          {/* ── Summary tiles ─────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile
              label="Total Purchases"
              qty={fmtQty(data.summary.purchaseQty, data.ingredient.unit)}
              value={data.summary.purchaseValuePaisa}
              accent="#4CAF50"
            />
            <Tile
              label="Net Usage"
              qty={fmtQty(data.summary.usageQty, data.ingredient.unit)}
              value={data.summary.usageValuePaisa}
              accent="#FFA726"
              footer={
                data.summary.voidReturnQty > 0
                  ? `Gross ${fmtQty(data.summary.usageGrossQty, data.ingredient.unit)} − Returns ${fmtQty(data.summary.voidReturnQty, data.ingredient.unit)}`
                  : undefined
              }
            />
            <Tile
              label="Total Wastage"
              qty={fmtQty(data.summary.wastageQty, data.ingredient.unit)}
              value={data.summary.wastageValuePaisa}
              accent="#D62B2B"
            />
            <Tile
              label="Closing Stock"
              qty={fmtQty(data.summary.closingStockQty, data.ingredient.unit)}
              value={data.summary.closingStockValuePaisa}
              accent="#FFFFFF"
              footer={`Opening ${fmtQty(data.summary.openingStockQty, data.ingredient.unit)} (${formatCurrency(data.summary.openingStockValuePaisa)})`}
            />
          </div>
          {(data.summary.adjustmentQty !== 0 || data.summary.voidReturnQty > 0) && (
            <p className="text-[11px] text-[#888]">
              {data.summary.voidReturnQty > 0 && (
                <>
                  Void returns to shelf: +{fmtQty(data.summary.voidReturnQty, data.ingredient.unit)} ({formatCurrency(data.summary.voidReturnValuePaisa)})
                </>
              )}
              {data.summary.voidReturnQty > 0 && data.summary.adjustmentQty !== 0 && <span> · </span>}
              {data.summary.adjustmentQty !== 0 && (
                <>
                  Manual adjustments: {data.summary.adjustmentQty >= 0 ? '+' : ''}
                  {fmtQty(data.summary.adjustmentQty, data.ingredient.unit)} ({formatCurrency(data.summary.adjustmentValuePaisa)})
                </>
              )}
            </p>
          )}

          {/* ── Day-by-day breakdown ─────────────────────── */}
          {data.days.length === 0 && (
            <p className="text-[#999] text-sm">No movements in this date range.</p>
          )}
          {data.days.map((day) => (
            <div key={day.date} className="sw-day">
              <div className="sw-day-title">{fmtDate(day.date)}</div>

              {day.purchases.length > 0 && (
                <>
                  <p className="sw-section-label">Purchases</p>
                  <table className="sw-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Supplier</th>
                        <th>PO</th>
                        <th className="num">Qty</th>
                        <th className="num">Unit Cost</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.purchases.map((r, i) => (
                        <tr key={i}>
                          <td>{fmtTime(r.time)}</td>
                          <td>
                            {r.type === 'PRODUCTION_RECEIVED' ? '— Production —' : r.supplierName ?? '—'}
                            {r.variantName && <span className="block text-[10px] text-[#888]">{r.variantName}</span>}
                          </td>
                          <td>{r.poNumber ?? '—'}</td>
                          <td className="num">+{fmtQty(r.quantity, r.unit)}</td>
                          <td className="num">{formatCurrency(r.unitCostPaisa)}/{r.unit}{r.isApprox && <span className="text-[#888] text-[10px]"> (approx.)</span>}</td>
                          <td className="num">{formatCurrency(r.totalPaisa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {day.sales.length > 0 && (
                <>
                  <p className="sw-section-label">Sales / Usage</p>
                  <table className="sw-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Order</th>
                        <th>Description</th>
                        <th className="num">Qty</th>
                        <th className="num">Unit Cost</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.sales.map((r, i) => (
                        <tr key={i}>
                          <td>{fmtTime(r.time)}</td>
                          <td>{r.orderNumber ?? '—'}</td>
                          <td className="text-[#ccc]">
                            {r.notes ?? '—'}
                            {r.variantName && <span className="block text-[10px] text-[#888]">{r.variantName}</span>}
                          </td>
                          <td className="num">−{fmtQty(r.quantity, data.ingredient.unit)}</td>
                          <td className="num">{formatCurrency(r.unitCostPaisa)}/{data.ingredient.unit}{r.isApprox && <span className="text-[#888] text-[10px]"> (approx.)</span>}</td>
                          <td className="num">{formatCurrency(r.totalPaisa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {day.wastage.length > 0 && (
                <>
                  <p className="sw-section-label">Wastage</p>
                  <table className="sw-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Kind</th>
                        <th>Reason</th>
                        <th>By / Order</th>
                        <th className="num">Qty</th>
                        <th className="num">Unit Cost</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.wastage.map((r, i) => (
                        <tr key={i}>
                          <td>{fmtTime(r.time)}</td>
                          <td>{r.kind === 'MANUAL' ? 'Manual' : 'Auto (Void)'}</td>
                          <td className="text-[#ccc]">
                            {r.reason ?? r.notes ?? '—'}
                            {r.variantName && <span className="block text-[10px] text-[#888]">{r.variantName}</span>}
                          </td>
                          <td className="text-[#ccc]">{r.kind === 'VOID_AUTO' ? r.orderNumber ?? '—' : r.recordedByName ?? '—'}</td>
                          <td className="num">−{fmtQty(r.quantity, data.ingredient.unit)}</td>
                          <td className="num">{formatCurrency(r.unitCostPaisa)}/{data.ingredient.unit}{r.isApprox && <span className="text-[#888] text-[10px]"> (approx.)</span>}</td>
                          <td className="num">{formatCurrency(r.totalPaisa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {day.other.length > 0 && (
                <>
                  <p className="sw-section-label">Adjustments / Returns</p>
                  <table className="sw-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>By / Order</th>
                        <th className="num">Qty</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.other.map((r, i) => (
                        <tr key={i}>
                          <td>{fmtTime(r.time)}</td>
                          <td>{r.type}</td>
                          <td className="text-[#ccc]">
                            {r.notes ?? '—'}
                            {r.variantName && <span className="block text-[10px] text-[#888]">{r.variantName}</span>}
                          </td>
                          <td className="text-[#ccc]">{r.staffName ?? r.orderNumber ?? '—'}</td>
                          <td className="num">{r.signedQuantity >= 0 ? '+' : '−'}{fmtQty(Math.abs(r.signedQuantity), data.ingredient.unit)}</td>
                          <td className="num">{formatCurrency(r.totalPaisa)}{r.isApprox && <span className="text-[#888] text-[10px]"> (approx.)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Tile({ label, qty, value, accent, footer }: { label: string; qty: string; value: number; accent: string; footer?: string }) {
  return (
    <div className="sw-tile">
      <p className="text-[10px] uppercase tracking-widest text-[#888]">{label}</p>
      <p className="font-display text-2xl mt-1" style={{ color: accent }}>{qty}</p>
      <p className="text-sm text-[#ccc] mt-0.5">{formatCurrency(value)}</p>
      {footer && <p className="text-[10px] text-[#888] mt-1">{footer}</p>}
    </div>
  );
}
