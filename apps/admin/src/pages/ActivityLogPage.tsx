import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

type ActivityCategory =
  | 'MENU' | 'RECIPE' | 'INGREDIENT' | 'SUPPLIER' | 'PURCHASING'
  | 'EXPENSE' | 'ACCOUNT' | 'PAYROLL' | 'CUSTOMER' | 'STAFF'
  | 'BRANCH' | 'DISCOUNT' | 'RESERVATION' | 'WASTE' | 'PRE_READY'
  | 'SETTINGS' | 'PERMISSIONS' | 'COOKING_STATION' | 'TABLE'
  | 'ATTENDANCE';

type ActivityAction = 'CREATE' | 'UPDATE' | 'DELETE';

interface ActivityLogRow {
  id: string;
  branchId: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  category: ActivityCategory;
  action: ActivityAction;
  entityType: string;
  entityId: string;
  entityName: string;
  diff: Record<string, unknown> | null;
  summary: string | null;
  createdAt: string;
}

interface ListResponse {
  data: ActivityLogRow[];
  meta: { nextCursor: string | null; count: number };
}

const CATEGORIES: ActivityCategory[] = [
  'MENU', 'RECIPE', 'INGREDIENT', 'SUPPLIER', 'PURCHASING',
  'EXPENSE', 'ACCOUNT', 'PAYROLL', 'CUSTOMER', 'STAFF',
  'BRANCH', 'DISCOUNT', 'RESERVATION', 'WASTE', 'PRE_READY',
  'SETTINGS', 'PERMISSIONS', 'COOKING_STATION', 'TABLE',
  'ATTENDANCE',
];

const ACTION_BADGE: Record<ActivityAction, string> = {
  CREATE: 'bg-[#4CAF50]/15 text-[#4CAF50] border-[#4CAF50]/30',
  UPDATE: 'bg-[#FFA726]/15 text-[#FFA726] border-[#FFA726]/30',
  DELETE: 'bg-[#D62B2B]/15 text-[#D62B2B] border-[#D62B2B]/30',
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().slice(0, 10);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ActivityLogPage() {
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [category, setCategory] = useState<ActivityCategory | ''>('');
  const [action, setAction] = useState<ActivityAction | ''>('');
  const [actorId, setActorId] = useState('');
  const [q, setQ] = useState('');
  const [openEntity, setOpenEntity] = useState<{ entityType: string; entityId: string; entityName: string } | null>(null);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (category) p.set('category', category);
    if (action) p.set('action', action);
    if (actorId) p.set('actorId', actorId);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [from, to, category, action, actorId, q]);

  const { data: list, refetch, isFetching } = useQuery<ListResponse>({
    queryKey: ['activity-logs', filterParams],
    queryFn: () => api.get<ListResponse>(`/activity-logs?${filterParams}&limit=100`),
  });

  const { data: catCounts = [] } = useQuery<Array<{ category: ActivityCategory; count: number }>>({
    queryKey: ['activity-log-categories', from, to],
    queryFn: () => api.get(`/activity-logs/categories?from=${from}&to=${to}`),
  });
  const countByCat = useMemo(() => new Map(catCounts.map((c) => [c.category, c.count])), [catCounts]);

  const { data: actors = [] } = useQuery<Array<{ actorId: string; actorName: string | null; actorRole: string | null }>>({
    queryKey: ['activity-log-actors', from, to],
    queryFn: () => api.get(`/activity-logs/actors?from=${from}&to=${to}`),
  });

  const rows = list?.data ?? [];
  const total = catCounts.reduce((s, c) => s + c.count, 0);
  const topCategory = catCounts.slice().sort((a, b) => b.count - a.count)[0];
  const topActor = useMemo(() => {
    const byActor = new Map<string, number>();
    for (const r of rows) {
      if (!r.actorId) continue;
      byActor.set(r.actorId, (byActor.get(r.actorId) ?? 0) + 1);
    }
    let bestId: string | null = null; let bestN = 0;
    for (const [id, n] of byActor) if (n > bestN) { bestN = n; bestId = id; }
    if (!bestId) return null;
    const a = actors.find((x) => x.actorId === bestId);
    return { name: a?.actorName ?? bestId, count: bestN };
  }, [rows, actors]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Audit</p>
          <h1 className="font-display text-4xl text-white tracking-wide">ACTIVITY LOG</h1>
          <p className="text-[#999] text-xs font-body mt-1">
            Every admin-config change — who, what, when. Sales / orders have their own audit fields.
            Auto-purged after 90 days.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="border border-[#2A2A2A] px-3 py-2 text-xs font-body text-[#999] hover:border-[#555] flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Date + quick chips */}
      <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]" />
          </div>
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]" />
          </div>
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Entity name or summary..."
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]" />
          </div>
          <div className="flex items-end gap-1.5">
            {[{ d: 0, l: 'Today' }, { d: 1, l: 'Yesterday' }, { d: 7, l: '7d' }, { d: 30, l: '30d' }].map(({ d, l }) => (
              <button key={l} onClick={() => { setFrom(daysAgoISO(d)); setTo(todayISO()); }}
                className="border border-[#2A2A2A] text-[#999] hover:border-[#555] px-2 py-1.5 text-[10px] tracking-widest uppercase">{l}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as any)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace('_', ' ')} ({countByCat.get(c) ?? 0})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value as any)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]">
              <option value="">All actions</option>
              <option value="CREATE">Created</option>
              <option value="UPDATE">Updated</option>
              <option value="DELETE">Deleted</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-body tracking-widest uppercase text-[#666] block mb-1">Actor</label>
            <select value={actorId} onChange={(e) => setActorId(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]">
              <option value="">Anyone</option>
              {actors.map((a) => (
                <option key={a.actorId} value={a.actorId}>
                  {a.actorName ?? a.actorId.slice(0, 8)} {a.actorRole ? `(${a.actorRole})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label={`Events (last ${Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)} days)`} value={String(total)} />
        <Tile label="Top category" value={topCategory ? `${topCategory.category.replace('_', ' ')} (${topCategory.count})` : '—'} />
        <Tile label="Most active actor" value={topActor ? `${topActor.name} (${topActor.count})` : '—'} />
      </div>

      {/* Table */}
      <div className="border border-[#2A2A2A] bg-[#0D0D0D]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-[#2A2A2A] text-[10px] tracking-widest uppercase text-[#666]">
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-left px-4 py-3 font-medium">Actor</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Entity</th>
              <th className="text-left px-4 py-3 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !isFetching && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-[#666]">
                No activity in the selected range.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}
                onClick={() => setOpenEntity({ entityType: r.entityType, entityId: r.entityId, entityName: r.entityName })}
                className="border-b border-[#1A1A1A] hover:bg-[#161616] cursor-pointer">
                <td className="px-4 py-3 text-[#999] whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <p className="text-white">{r.actorName ?? <span className="text-[#666] italic">system</span>}</p>
                  {r.actorRole && <p className="text-[10px] text-[#666] uppercase tracking-widest">{r.actorRole}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] tracking-widest uppercase text-[#DDD9D3]">{r.category.replace('_', ' ')}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] tracking-widest uppercase border px-2 py-0.5 ${ACTION_BADGE[r.action]}`}>{r.action}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-white">{r.entityName}</p>
                  <p className="text-[10px] text-[#666]">{r.entityType}</p>
                </td>
                <td className="px-4 py-3 text-[#DDD9D3]">{r.summary ?? <span className="text-[#666]">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openEntity && (
        <EntityHistoryModal
          entityType={openEntity.entityType}
          entityId={openEntity.entityId}
          entityName={openEntity.entityName}
          onClose={() => setOpenEntity(null)}
        />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#2A2A2A] bg-[#0D0D0D] px-4 py-3">
      <p className="text-[10px] font-body tracking-widest uppercase text-[#666]">{label}</p>
      <p className="text-2xl font-display text-white mt-1">{value}</p>
    </div>
  );
}

/**
 * Per-entity history drill-in. Mirrors the CustomersPage detail-modal
 * pattern — sticky header, scrollable body, dismissable on backdrop
 * click. Renders the full chronological audit trail for one entity
 * (the "click Orange Juice → see every change ever made to it" view).
 */
function EntityHistoryModal({ entityType, entityId, entityName, onClose }: {
  entityType: string; entityId: string; entityName: string; onClose: () => void;
}) {
  const { data: history = [], isLoading } = useQuery<ActivityLogRow[]>({
    queryKey: ['activity-log-entity', entityType, entityId],
    queryFn: () => api.get(`/activity-logs/entity/${entityType}/${entityId}`),
  });

  // Trap escape to close so the keyboard-driven workflow doesn't get
  // stuck inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-[#161616] border border-[#2A2A2A] w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#2A2A2A] shrink-0">
          <div>
            <p className="text-[10px] tracking-widest uppercase text-[#D62B2B]">History</p>
            <h2 className="font-display text-xl text-white tracking-wide">{entityName}</h2>
            <p className="text-[10px] text-[#666] uppercase tracking-widest">{entityType}</p>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>

        <div className="overflow-auto p-5 space-y-4">
          {isLoading ? (
            <p className="text-center text-[#666] py-12 text-sm">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-center text-[#666] py-12 text-sm">No activity recorded for this item.</p>
          ) : (
            history.map((row) => <HistoryRow key={row.id} row={row} />)
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ row }: { row: ActivityLogRow }) {
  const diff = row.diff;
  let entries: Array<{ field: string; before: unknown; after: unknown }> = [];
  let snapshot: Record<string, unknown> | null = null;
  let snapshotKind: 'created' | 'deleted' | null = null;
  if (diff && typeof diff === 'object') {
    const d = diff as Record<string, unknown>;
    if ('__after' in d || '__before' in d) {
      snapshot = (d.__after ?? d.__before) as Record<string, unknown>;
      snapshotKind = '__after' in d ? 'created' : 'deleted';
    } else {
      entries = Object.entries(diff as Record<string, { before: unknown; after: unknown }>)
        .map(([field, v]) => ({ field, before: v.before, after: v.after }))
        .filter((e) => !isNoiseField(e.field));
    }
  }

  return (
    <div className="border border-[#2A2A2A] bg-[#0D0D0D]">
      <div className="px-4 py-2 border-b border-[#2A2A2A] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-[10px] tracking-widest uppercase border px-2 py-0.5 ${ACTION_BADGE[row.action]}`}>{row.action}</span>
          <span className="text-[10px] tracking-widest uppercase text-[#666]">{row.category.replace('_', ' ')}</span>
          {row.summary && <span className="text-xs text-[#DDD9D3]">{row.summary}</span>}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[#999]">{fmtTime(row.createdAt)}</p>
          <p className="text-[10px] text-[#666]">{row.actorName ?? 'system'} {row.actorRole ? `(${row.actorRole})` : ''}</p>
        </div>
      </div>
      <div className="px-4 py-3">
        {entries.length > 0 ? (
          <table className="w-full text-xs font-body">
            <thead>
              <tr className="text-[10px] tracking-widest uppercase text-[#555]">
                <th className="text-left py-1 font-medium w-1/4">Field</th>
                <th className="text-left py-1 font-medium" colSpan={2}>Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const itemsDiff = tryRenderNamedArrayDiff(e.before, e.after);
                if (itemsDiff) {
                  return (
                    <tr key={e.field} className="border-t border-[#1A1A1A]">
                      <td className="py-1.5 text-[#DDD9D3] font-medium align-top">{humanizeField(e.field)}</td>
                      <td className="py-1.5" colSpan={2}>{itemsDiff}</td>
                    </tr>
                  );
                }
                if (isPlainObject(e.before) || isPlainObject(e.after)) {
                  return (
                    <tr key={e.field} className="border-t border-[#1A1A1A]">
                      <td className="py-1.5 text-[#DDD9D3] font-medium align-top">{humanizeField(e.field)}</td>
                      <td className="py-1.5" colSpan={2}>
                        {renderObjectChange(e.before, e.after)}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={e.field} className="border-t border-[#1A1A1A]">
                    <td className="py-1.5 text-[#DDD9D3] font-medium align-top">{humanizeField(e.field)}</td>
                    <td className="py-1.5 text-[#D62B2B] line-through pr-3 align-top">{renderScalar(e.before, e.field)}</td>
                    <td className="py-1.5 text-[#4CAF50] align-top">{renderScalar(e.after, e.field)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : snapshot ? (
          renderSnapshot(snapshot, snapshotKind)
        ) : (
          <p className="text-[10px] text-[#666] italic">No diff captured.</p>
        )}
      </div>
    </div>
  );
}

// ── Field-name helpers ──────────────────────────────────────────────

/** Drop fields that are pure noise in an audit context: row id,
 *  branch scoping, who-recorded-this, timestamps the activity-log
 *  itself already shows. */
function isNoiseField(field: string): boolean {
  const f = field.toLowerCase();
  return (
    f === 'id' ||
    f === 'branchid' ||
    f === 'createdat' ||
    f === 'updatedat' ||
    f === 'deletedat'
  );
}

/** "costPerUnit" -> "Cost Per Unit", "menuItemId" -> "Menu Item ID",
 *  "tax_amount" -> "Tax Amount". Display only; the underlying field
 *  name is preserved on the row data. */
function humanizeField(field: string): string {
  const spaced = field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bId\b/g, 'ID');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── Value detection ──────────────────────────────────────────────────

const CUID_RE = /^c[a-z0-9]{24,}$/;

function isCuid(v: unknown): boolean {
  return typeof v === 'string' && CUID_RE.test(v);
}

function isISODateString(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Money fields stored as paisa (1/100 of a taka). The renderer spots
 *  them by suffix so the audit log shows "৳12.50" instead of "1250".
 *  `amount` is included here because — despite the name — every
 *  `Decimal(14,2)` `amount` column in this codebase (Expense,
 *  AccountTransaction, SupplierPayment, CreditorBill, …) is stored
 *  in paisa. Without this, an Expense of ৳200 displays as ৳20,000. */
function isPaisaField(field: string): boolean {
  return /paisa$|^amount$|amount$/i.test(field);
}

/** Legacy "Cents" suffix — historical sub-paisa amounts that some old
 *  rows still carry. Treated as already-in-major-units to preserve
 *  whatever the historical renderer showed. */
function isCurrencyField(field: string): boolean {
  return /cents$/i.test(field);
}

function fmtPaisa(n: number): string {
  return `৳${(n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAmount(n: number): string {
  return `৳${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  // Trim trailing zeros so "150.0000" reads as "150".
  return String(Math.round(n * 10000) / 10000);
}

function fmtIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Best-effort short label for a nested ref: prefer name/title fields,
 *  else first non-id string. Returns null when nothing usable. */
function refLabel(obj: Record<string, unknown>): string | null {
  for (const k of ['name', 'title', 'menuItemName', 'ingredientName', 'displayName', 'orderNumber']) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// ── Scalar / object renderers ───────────────────────────────────────

function renderScalar(v: unknown, field?: string): string {
  if (v == null) return '∅';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    if (field && isPaisaField(field)) return fmtPaisa(v);
    if (field && isCurrencyField(field)) return fmtAmount(v);
    return fmtNum(v);
  }
  if (typeof v === 'string') {
    if (isCuid(v)) return '—';
    if (isISODateString(v)) return fmtIso(v);
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (isPlainObject(v)) {
    const label = refLabel(v);
    if (label) return label;
    try { return JSON.stringify(v).slice(0, 120); } catch { return '[object]'; }
  }
  return String(v);
}

/** Render a nested-object change (or one-sided create/delete of the
 *  nested ref). Falls back to per-field key/value lines when both
 *  sides are objects. */
function renderObjectChange(before: unknown, after: unknown): JSX.Element {
  // One-sided: the whole nested ref appeared / disappeared.
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return (
      <div className="flex gap-2 text-[11px] leading-snug">
        <span className="text-[#D62B2B] line-through">{renderScalar(before)}</span>
        <span className="text-[#888]">→</span>
        <span className="text-[#4CAF50]">{renderScalar(after)}</span>
      </div>
    );
  }
  // Both sides are objects: show a per-field mini-diff for the
  // changed sub-fields only.
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: JSX.Element[] = [];
  for (const k of keys) {
    if (isNoiseField(k)) continue;
    const b = (before as Record<string, unknown>)[k];
    const a = (after as Record<string, unknown>)[k];
    if (jsonEqual(b, a)) continue;
    rows.push(
      <div key={k} className="flex gap-2 text-[11px] leading-snug">
        <span className="text-[#888] w-32 shrink-0">{humanizeField(k)}</span>
        <span className="text-[#D62B2B] line-through">{renderScalar(b, k)}</span>
        <span className="text-[#888]">→</span>
        <span className="text-[#4CAF50]">{renderScalar(a, k)}</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return <span className="text-[#666] italic text-[11px]">No visible change.</span>;
  }
  return <div className="space-y-0.5">{rows}</div>;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// ── Snapshot renderer (CREATE / DELETE) ─────────────────────────────

/** Replace the JSON-blob fallback for CREATE/DELETE rows with a flat
 *  field list rendered the same way as UPDATE rows — humanized field
 *  names, money formatting, cuid hiding. Nested arrays of named
 *  objects (eg recipe items) get the same colour-coded diff treatment
 *  against an empty counterpart so the snapshot lists "+ X, + Y" for
 *  create and "− X, − Y" for delete. */
function renderSnapshot(snap: Record<string, unknown>, kind: 'created' | 'deleted' | null): JSX.Element {
  const entries = Object.entries(snap).filter(([k]) => !isNoiseField(k));
  if (entries.length === 0) {
    return <p className="text-[10px] text-[#666] italic">Empty snapshot.</p>;
  }
  const tone = kind === 'deleted' ? 'text-[#D62B2B]' : 'text-[#4CAF50]';
  return (
    <table className="w-full text-xs font-body">
      <tbody>
        {entries.map(([k, v]) => {
          // Recipe-items style array? Render as colour-coded list.
          if (isNamedArray(v)) {
            const empty: Record<string, unknown>[] = [];
            const diff = kind === 'deleted'
              ? tryRenderNamedArrayDiff(v, empty)
              : tryRenderNamedArrayDiff(empty, v);
            return (
              <tr key={k} className="border-t border-[#1A1A1A]">
                <td className="py-1.5 text-[#DDD9D3] font-medium align-top w-1/4">{humanizeField(k)}</td>
                <td className="py-1.5">{diff}</td>
              </tr>
            );
          }
          // Nested object — show one-line ref label or a mini key-value list.
          if (isPlainObject(v)) {
            const label = refLabel(v);
            return (
              <tr key={k} className="border-t border-[#1A1A1A]">
                <td className="py-1.5 text-[#DDD9D3] font-medium align-top w-1/4">{humanizeField(k)}</td>
                <td className={`py-1.5 ${tone}`}>{label ?? renderInlineObject(v)}</td>
              </tr>
            );
          }
          return (
            <tr key={k} className="border-t border-[#1A1A1A]">
              <td className="py-1.5 text-[#DDD9D3] font-medium align-top w-1/4">{humanizeField(k)}</td>
              <td className={`py-1.5 ${tone}`}>{renderScalar(v, k)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function renderInlineObject(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isNoiseField(k) || isCuid(v)) continue;
    parts.push(`${humanizeField(k)}: ${renderScalar(v, k)}`);
    if (parts.length >= 4) { parts.push('…'); break; }
  }
  return parts.join(', ') || '∅';
}

// ── Named-array diff (generalized recipe renderer) ──────────────────

/** Detect arrays whose items expose a stable display name. Covers
 *  recipe items (`ingredientName`), PO lines + variants (`name` /
 *  `menuItemName`), discount tiers, etc. — anything where matching
 *  by display name gives a meaningful add/remove/change view. */
function isNamedArray(v: unknown): v is Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return false;
  if (v.length === 0) return true; // empty still classifies — supports CREATE/DELETE
  const first = v[0];
  if (!isPlainObject(first)) return false;
  return typeof refLabel(first) === 'string';
}

/** Render an array-of-objects diff as colour-coded add/remove/change
 *  lines, matching items by display name. Generalises the recipe-
 *  items renderer to any "list of named things" — PO items, variants,
 *  modifier groups, etc. */
function tryRenderNamedArrayDiff(before: unknown, after: unknown): JSX.Element | null {
  if (!isNamedArray(before) && !isNamedArray(after)) return null;
  const beforeArr = isNamedArray(before) ? before : [];
  const afterArr = isNamedArray(after) ? after : [];

  const keyOf = (it: Record<string, unknown>) => (refLabel(it) ?? '').toLowerCase();
  const byKeyBefore = new Map<string, Record<string, unknown>>();
  for (const it of beforeArr) byKeyBefore.set(keyOf(it), it);
  const byKeyAfter = new Map<string, Record<string, unknown>>();
  for (const it of afterArr) byKeyAfter.set(keyOf(it), it);

  const added: Record<string, unknown>[] = [];
  const removed: Record<string, unknown>[] = [];
  const changed: Array<{ name: string; from: Record<string, unknown>; to: Record<string, unknown> }> = [];

  for (const [key, b] of byKeyBefore) {
    const a = byKeyAfter.get(key);
    if (!a) {
      removed.push(b);
    } else if (!jsonEqual(stripIds(a), stripIds(b))) {
      changed.push({ name: refLabel(a) ?? key, from: b, to: a });
    }
  }
  for (const [key, a] of byKeyAfter) {
    if (!byKeyBefore.has(key)) added.push(a);
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return <span className="text-[#666] italic text-[11px]">No visible changes (notes / order only).</span>;
  }

  return (
    <div className="space-y-0.5 text-[11px] font-body leading-snug">
      {added.map((a, i) => (
        <div key={`a-${i}`} className="text-[#4CAF50]">
          + {refLabel(a)}: {summarizeRowFields(a)}
        </div>
      ))}
      {changed.map((c, i) => (
        <div key={`c-${i}`} className="text-[#FFA726]">
          {c.name}: <span className="text-[#888]">{summarizeRowFields(c.from)}</span>
          <span className="text-[#888] mx-1">→</span>
          {summarizeRowFields(c.to)}
        </div>
      ))}
      {removed.map((r, i) => (
        <div key={`r-${i}`} className="text-[#D62B2B]">
          − {refLabel(r)}: {summarizeRowFields(r)}
        </div>
      ))}
    </div>
  );
}

/** Drop id-shaped + noise fields so jsonEqual doesn't flag spurious
 *  diffs caused by Prisma echoing back the same ids in a different
 *  order. */
function stripIds(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isNoiseField(k)) continue;
    if (k.toLowerCase().endsWith('id') && isCuid(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Inline summary of the meaningful fields on one named-array row.
 *  Skips the name (already shown as the row label), cuids, and noise.
 *  Keeps it short — the diff line should fit on one row. */
function summarizeRowFields(row: Record<string, unknown>): string {
  const parts: string[] = [];
  const nameKey = (() => {
    for (const k of ['name', 'title', 'menuItemName', 'ingredientName', 'displayName', 'orderNumber']) {
      if (k in row && typeof row[k] === 'string') return k;
    }
    return null;
  })();
  // Quantity + unit pair gets condensed into one piece — covers the
  // most common "ingredient: 50 G" recipe-line shape.
  if ('quantity' in row && typeof row.quantity === 'number') {
    const unit = typeof row.unit === 'string' ? ` ${row.unit}` : '';
    parts.push(`${fmtNum(row.quantity)}${unit}`);
  }
  for (const [k, v] of Object.entries(row)) {
    if (k === nameKey || k === 'quantity' || k === 'unit') continue;
    if (isNoiseField(k) || isCuid(v)) continue;
    if (k.toLowerCase().endsWith('id')) continue;
    if (v == null || v === '') continue;
    parts.push(`${humanizeField(k)}: ${renderScalar(v, k)}`);
    if (parts.length >= 4) { parts.push('…'); break; }
  }
  return parts.join(', ');
}
