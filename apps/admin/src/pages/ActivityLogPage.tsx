import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

type ActivityCategory =
  | 'MENU' | 'RECIPE' | 'INGREDIENT' | 'SUPPLIER' | 'PURCHASING'
  | 'EXPENSE' | 'ACCOUNT' | 'PAYROLL' | 'CUSTOMER' | 'STAFF'
  | 'BRANCH' | 'DISCOUNT' | 'RESERVATION' | 'WASTE' | 'PRE_READY'
  | 'SETTINGS' | 'PERMISSIONS' | 'COOKING_STATION' | 'TABLE';

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
  if (diff && typeof diff === 'object') {
    if ('__after' in diff || '__before' in diff) {
      snapshot = ((diff as Record<string, unknown>).__after ?? (diff as Record<string, unknown>).__before) as Record<string, unknown>;
    } else {
      entries = Object.entries(diff as Record<string, { before: unknown; after: unknown }>)
        .map(([field, v]) => ({ field, before: v.before, after: v.after }));
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
                <th className="text-left py-1 font-medium">Field</th>
                <th className="text-left py-1 font-medium">Before</th>
                <th className="text-left py-1 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.field} className="border-t border-[#1A1A1A]">
                  <td className="py-1.5 text-[#DDD9D3] font-medium">{e.field}</td>
                  <td className="py-1.5 text-[#D62B2B] line-through">{renderValue(e.before)}</td>
                  <td className="py-1.5 text-[#4CAF50]">{renderValue(e.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : snapshot ? (
          <pre className="text-[10px] text-[#999] overflow-auto whitespace-pre-wrap">{JSON.stringify(snapshot, null, 2)}</pre>
        ) : (
          <p className="text-[10px] text-[#666] italic">No diff captured.</p>
        )}
      </div>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(v);
  }
}
