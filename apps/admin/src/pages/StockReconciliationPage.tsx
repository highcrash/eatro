import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, ClipboardCheck, X } from 'lucide-react';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import type {
  ReconciliationSheet,
  ReconciliationSheetRow,
  ReconciliationSubmitDto,
  ReconciliationSubmitResult,
  WasteReason,
} from '@restora/types';

const WASTE_REASONS: WasteReason[] = [
  'SPOILAGE', 'PREPARATION_ERROR', 'OVERCOOKED', 'CONTAMINATION', 'EXPIRED', 'OTHER',
];

type SortMode = 'alpha' | 'category';

interface RowState {
  physicalQty: string;
  reason: WasteReason;
}

export default function StockReconciliationPage() {
  const queryClient = useQueryClient();

  const [windowDays, setWindowDays] = useState(7);
  const [sortMode, setSortMode] = useState<SortMode>('alpha');
  const [notes, setNotes] = useState('');
  const [counts, setCounts] = useState<Record<string, RowState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultModal, setResultModal] = useState<ReconciliationSubmitResult | null>(null);

  const { data: sheet, isLoading } = useQuery<ReconciliationSheet>({
    queryKey: ['reconciliation-sheet', windowDays],
    queryFn: () => api.get<ReconciliationSheet>(`/reconciliation/sheet?windowDays=${windowDays}`),
  });

  const submitMutation = useMutation<ReconciliationSubmitResult, Error, ReconciliationSubmitDto>({
    mutationFn: (dto) => api.post<ReconciliationSubmitResult>('/reconciliation/submit', dto),
    onSuccess: (result) => {
      setResultModal(result);
      setConfirmOpen(false);
      setCounts({});
      // Live stock numbers shifted — invalidate every consumer.
      queryClient.invalidateQueries({ queryKey: ['reconciliation-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['waste'] });
      queryClient.invalidateQueries({ queryKey: ['stock-watcher'] });
    },
  });

  const sortedRows = useMemo(() => {
    if (!sheet) return [];
    const rows = [...sheet.rows];
    rows.sort((a, b) => {
      if (a.hasRecentMovement !== b.hasRecentMovement) {
        return a.hasRecentMovement ? -1 : 1;
      }
      if (sortMode === 'category') {
        const ac = a.category ?? 'ZZZ';
        const bc = b.category ?? 'ZZZ';
        if (ac !== bc) return ac.localeCompare(bc);
      }
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [sheet, sortMode]);

  const stagedRows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows
      .map((r) => {
        const c = counts[r.ingredientId];
        if (!c || c.physicalQty.trim() === '') return null;
        const qty = Number(c.physicalQty);
        if (!Number.isFinite(qty) || qty < 0) return null;
        const delta = round4(qty - r.currentStock);
        return {
          row: r,
          physicalQty: qty,
          delta,
          reason: c.reason,
          valuePaisa: Math.round(Math.abs(delta) * r.costPerUnit),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [counts, sheet]);

  const stagedSummary = useMemo(() => {
    let wasteCount = 0;
    let adjustmentCount = 0;
    let valueDown = 0;
    let valueUp = 0;
    for (const s of stagedRows) {
      if (Math.abs(s.delta) < 0.0001) continue;
      if (s.delta < 0) { wasteCount += 1; valueDown += s.valuePaisa; }
      else { adjustmentCount += 1; valueUp += s.valuePaisa; }
    }
    return { wasteCount, adjustmentCount, valueDown, valueUp, total: stagedRows.length };
  }, [stagedRows]);

  const setRow = (id: string, patch: Partial<RowState>) => {
    setCounts((prev) => {
      const existing: RowState = prev[id] ?? { physicalQty: '', reason: 'SPOILAGE' };
      return { ...prev, [id]: { ...existing, ...patch } };
    });
  };

  const onSubmit = () => {
    const dto: ReconciliationSubmitDto = {
      notes: notes.trim() || undefined,
      rows: stagedRows.map((s) => ({
        ingredientId: s.row.ingredientId,
        physicalQty: s.physicalQty,
        reason: s.reason,
      })),
    };
    submitMutation.mutate(dto);
  };

  const canSubmit = stagedSummary.total > 0 && !submitMutation.isPending;

  return (
    <div className="space-y-6 stock-reconciliation-page">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .stock-reconciliation-page, .stock-reconciliation-page * {
            visibility: visible !important;
          }
          .stock-reconciliation-page {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
            font-family: Arial, sans-serif !important;
          }
          .stock-reconciliation-page * {
            color: #000 !important;
            background: transparent !important;
            border-color: #999 !important;
          }
          .no-print { display: none !important; }
          .sr-table th, .sr-table td { border: 1px solid #ccc !important; padding: 4px 8px !important; }
          .sr-physical-cell { border: 1px solid #999 !important; height: 24px !important; min-width: 60px !important; }
          .sr-section-head { font-weight: 700 !important; padding: 6px 0 !important; }
          tr.sr-dormant td { color: #555 !important; }
        }
        .sr-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #e6e6e6; }
        .sr-table th { text-align: left; padding: 8px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; background: #161616; border-bottom: 1px solid #2a2a2a; }
        .sr-table td { padding: 6px 8px; border-top: 1px solid #2a2a2a; vertical-align: middle; color: inherit; }
        .sr-table tr.sr-dormant td { color: #777; }
        .sr-table tr.sr-section td { background: #0a0a0a; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; padding: 8px; }
        .sr-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .sr-table .num.gain { color: #4CAF50; }
        .sr-table .num.loss { color: #FFA726; }
        .sr-input { background: #0d0d0d; border: 1px solid #2a2a2a; color: #fff; padding: 4px 8px; width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
        .sr-input:focus { outline: none; border-color: #d62b2b; }
        .sr-reason { background: #0d0d0d; border: 1px solid #2a2a2a; color: #ddd; padding: 4px 8px; font-size: 11px; }
        .sr-reason:disabled { opacity: 0.3; }
      `}</style>

      {/* ── Header bar ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 no-print">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">STOCK RECONCILIATION</h1>
          <p className="text-xs text-[#999] mt-1">Print the count sheet, walk the storeroom, type the actuals, submit. Lower than software → logged as waste; higher → logged as adjustment.</p>
        </div>
        <div className="flex-1" />
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">Movement window</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={windowDays}
              onChange={(e) => setWindowDays(Math.max(1, Math.min(365, Number(e.target.value) || 7)))}
              className="bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm w-20"
            />
            <span className="text-xs text-[#999]">days</span>
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">Sort</label>
          <div className="inline-flex border border-[#2a2a2a]">
            {(['alpha', 'category'] as SortMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`px-3 py-2 text-xs uppercase tracking-widest ${sortMode === m ? 'bg-[#d62b2b] text-white' : 'bg-[#161616] text-[#999] hover:text-white'}`}
              >
                {m === 'alpha' ? 'Alphabetical' : 'By Category'}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm hover:border-[#444]"
        >
          <Printer size={14} /> Print Count Sheet
        </button>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!canSubmit}
          className="flex items-center gap-2 bg-[#d62b2b] text-white px-4 py-2 text-sm hover:bg-[#b51e1e] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ClipboardCheck size={14} /> Submit ({stagedSummary.total})
        </button>
      </div>

      {/* ── Notes ───────────────────────────────────────────── */}
      <div className="no-print">
        <label className="block text-[10px] uppercase tracking-widest text-[#999] mb-1">Run notes (optional, e.g. "End-of-April count")</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Becomes part of every WasteLog and StockMovement note for this run"
          className="w-full bg-[#161616] border border-[#2a2a2a] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#d62b2b]"
        />
      </div>

      {/* ── Print-only header ─────────────────────────────── */}
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold mb-1">Stock Count Sheet</h1>
        <p className="text-xs">Generated: {sheet?.generatedAt ? new Date(sheet.generatedAt).toLocaleString() : '—'}</p>
        <p className="text-xs">Movement window: last {windowDays} days · Sort: {sortMode === 'alpha' ? 'Alphabetical' : 'By Category'}</p>
        {notes && <p className="text-xs">Note: {notes}</p>}
      </div>

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {/* ── Live tally tiles ────────────────────────────────── */}
      {stagedSummary.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
          <Tile label="Counted rows" value={String(stagedSummary.total)} />
          <Tile label="Will log waste" value={String(stagedSummary.wasteCount)} sub={formatCurrency(stagedSummary.valueDown)} tone="loss" />
          <Tile label="Will adjust up" value={String(stagedSummary.adjustmentCount)} sub={formatCurrency(stagedSummary.valueUp)} tone="gain" />
          <Tile label="Net value impact" value={formatCurrency(stagedSummary.valueUp - stagedSummary.valueDown)} />
        </div>
      )}

      {/* ── Count table ─────────────────────────────────────── */}
      {sheet && (
        <CountTable
          rows={sortedRows}
          counts={counts}
          setRow={setRow}
          sortMode={sortMode}
        />
      )}

      {confirmOpen && (
        <ConfirmModal
          summary={stagedSummary}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={onSubmit}
          submitting={submitMutation.isPending}
          error={submitMutation.error?.message ?? null}
        />
      )}

      {resultModal && (
        <ResultModal result={resultModal} onClose={() => setResultModal(null)} />
      )}
    </div>
  );
}

function CountTable({
  rows, counts, setRow, sortMode,
}: {
  rows: ReconciliationSheetRow[];
  counts: Record<string, RowState>;
  setRow: (id: string, patch: Partial<RowState>) => void;
  sortMode: SortMode;
}) {
  // Group runs of consecutive rows that share the same section header.
  // Two-level grouping: hasRecentMovement first (Active vs Dormant),
  // then category if the user picked the categorised sort. Keeps the
  // visual hierarchy consistent on screen and on print.
  const sections: Array<{ label: string; rows: ReconciliationSheetRow[] }> = [];
  let prevKey = '';
  for (const r of rows) {
    const movementLabel = r.hasRecentMovement ? 'Recently moved' : 'Dormant';
    const key = sortMode === 'category'
      ? `${movementLabel} · ${r.category ?? 'Uncategorised'}`
      : movementLabel;
    if (key !== prevKey) {
      sections.push({ label: key, rows: [] });
      prevKey = key;
    }
    sections[sections.length - 1].rows.push(r);
  }

  return (
    <div className="border border-[#2a2a2a] overflow-x-auto">
      <table className="sr-table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Category</th>
            <th>Unit</th>
            <th className="num">In Stock</th>
            <th className="num">Physical Count</th>
            <th className="num">Variance</th>
            <th>Reason (when low)</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <SectionGroup
              key={section.label}
              section={section}
              counts={counts}
              setRow={setRow}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionGroup({
  section, counts, setRow,
}: {
  section: { label: string; rows: ReconciliationSheetRow[] };
  counts: Record<string, RowState>;
  setRow: (id: string, patch: Partial<RowState>) => void;
}) {
  return (
    <>
      <tr className="sr-section sr-section-head">
        <td colSpan={7}>{section.label} ({section.rows.length})</td>
      </tr>
      {section.rows.map((r) => {
        const state = counts[r.ingredientId];
        const physical = state?.physicalQty ?? '';
        const physicalNum = physical.trim() === '' ? null : Number(physical);
        const delta = physicalNum != null && Number.isFinite(physicalNum)
          ? round4(physicalNum - r.currentStock)
          : null;
        const dormant = !r.hasRecentMovement;
        return (
          <tr key={r.ingredientId} className={dormant ? 'sr-dormant' : ''}>
            <td>
              {r.parentName && <span className="text-[#666] mr-1">{r.parentName} ·</span>}
              <span className="text-white">{r.name}</span>
              {r.lastMovementAt && (
                <span className="text-[10px] text-[#666] ml-2">
                  last moved {new Date(r.lastMovementAt).toLocaleDateString()}
                </span>
              )}
            </td>
            <td className="text-[#888]">{r.category ?? '—'}</td>
            <td className="text-[#888]">{r.unit}</td>
            <td className="num">{trim(r.currentStock)}</td>
            <td className="num">
              <input
                type="number"
                step="0.0001"
                min={0}
                value={physical}
                onChange={(e) => setRow(r.ingredientId, { physicalQty: e.target.value })}
                className="sr-input no-print"
                placeholder="—"
              />
              <span className="hidden print:inline-block sr-physical-cell">&nbsp;</span>
            </td>
            <td className={`num ${delta == null ? '' : delta < 0 ? 'loss' : delta > 0 ? 'gain' : ''}`}>
              {delta == null ? '—' : delta === 0 ? '0' : delta > 0 ? `+${trim(delta)}` : trim(delta)}
            </td>
            <td>
              <select
                value={state?.reason ?? 'SPOILAGE'}
                onChange={(e) => setRow(r.ingredientId, { reason: e.target.value as WasteReason })}
                disabled={delta == null || delta >= 0}
                className="sr-reason no-print"
              >
                {WASTE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{reason.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ConfirmModal({
  summary, onCancel, onConfirm, submitting, error,
}: {
  summary: { total: number; wasteCount: number; adjustmentCount: number; valueDown: number; valueUp: number };
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <Backdrop onClose={submitting ? () => {} : onCancel}>
      <div className="bg-[#0d0d0d] border border-[#2a2a2a] w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Confirm reconciliation</h2>
          {!submitting && <button onClick={onCancel} className="text-[#666] hover:text-white"><X size={16} /></button>}
        </div>
        <div className="space-y-2 text-sm text-[#ccc]">
          <Row label="Counted rows" value={String(summary.total)} />
          <Row label="To log as waste" value={`${summary.wasteCount} rows · ${formatCurrency(summary.valueDown)}`} tone="loss" />
          <Row label="To log as adjustment" value={`${summary.adjustmentCount} rows · ${formatCurrency(summary.valueUp)}`} tone="gain" />
        </div>
        <p className="text-xs text-[#888]">Each variance becomes a permanent stock movement. Per-row writes are independent — if one fails the others still apply.</p>
        {error && <p className="text-xs text-[#ff6b6b]">Error: {error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} disabled={submitting} className="px-4 py-2 text-sm text-[#999] border border-[#2a2a2a] hover:text-white">Cancel</button>
          <button onClick={onConfirm} disabled={submitting} className="px-4 py-2 text-sm bg-[#d62b2b] text-white hover:bg-[#b51e1e] disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit reconciliation'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function ResultModal({ result, onClose }: { result: ReconciliationSubmitResult; onClose: () => void }) {
  return (
    <Backdrop onClose={onClose}>
      <div className="bg-[#0d0d0d] border border-[#2a2a2a] w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
          <h2 className="text-lg font-bold text-white">Reconciliation complete</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Tile label="Logged as waste" value={String(result.wasteRows)} sub={formatCurrency(result.valuePaisaDown)} tone="loss" />
          <Tile label="Adjusted up" value={String(result.adjustmentRows)} sub={formatCurrency(result.valuePaisaUp)} tone="gain" />
          <Tile label="Skipped (matched)" value={String(result.skippedRows)} />
          <Tile label="Failed" value={String(result.failedRows)} tone={result.failedRows > 0 ? 'loss' : undefined} />
        </div>
        <div className="overflow-y-auto px-4 pb-4">
          <table className="sr-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th className="num">Before</th>
                <th className="num">After</th>
                <th className="num">Delta</th>
                <th>Outcome</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.ingredientId}>
                  <td className="text-white">{r.ingredientName}</td>
                  <td className="num">{trim(r.before)} {r.unit}</td>
                  <td className="num">{trim(r.after)} {r.unit}</td>
                  <td className={`num ${r.delta < 0 ? 'loss' : r.delta > 0 ? 'gain' : ''}`}>
                    {r.delta === 0 ? '0' : r.delta > 0 ? `+${trim(r.delta)}` : trim(r.delta)}
                  </td>
                  <td className={r.outcome === 'failed' ? 'text-[#ff6b6b]' : 'text-[#999]'}>
                    {r.outcome}
                    {r.error && <span className="block text-[10px] text-[#888]">{r.error}</span>}
                  </td>
                  <td className="num">{r.valuePaisa ? formatCurrency(r.valuePaisa) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 no-print">
      {children}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'gain' | 'loss' }) {
  const colour = tone === 'gain' ? 'text-[#4CAF50]' : tone === 'loss' ? 'text-[#FFA726]' : 'text-white';
  return (
    <div className="bg-[#161616] border border-[#2a2a2a] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-[#888]">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colour}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#666] mt-1">{sub}</p>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const colour = tone === 'gain' ? 'text-[#4CAF50]' : tone === 'loss' ? 'text-[#FFA726]' : 'text-white';
  return (
    <div className="flex justify-between">
      <span className="text-[#888]">{label}</span>
      <span className={colour}>{value}</span>
    </div>
  );
}

function trim(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
