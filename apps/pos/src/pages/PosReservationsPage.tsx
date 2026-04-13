import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Users, Phone, X, Clock, Check, XCircle, UserCheck, Ban } from 'lucide-react';

import { api } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

interface Reservation {
  id: string;
  branchId: string;
  customerName: string;
  customerPhone: string;
  date: string;
  timeSlot: string;
  partySize: number;
  status: ReservationStatus;
  tableId: string | null;
  notes: string | null;
  table?: { tableNumber: number; capacity: number };
  confirmedBy?: { name: string };
}

interface Table {
  id: string;
  tableNumber: number;
  capacity: number;
  status: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Tab = 'upcoming' | 'arrived' | 'all';

const STATUS_BADGE: Record<ReservationStatus, string> = {
  PENDING:   'bg-yellow-500/20 text-yellow-500',
  CONFIRMED: 'bg-blue-500/20 text-blue-500',
  ARRIVED:   'bg-green-500/20 text-green-500',
  COMPLETED: 'bg-gray-500/20 text-gray-500',
  NO_SHOW:   'bg-red-500/20 text-red-500',
  CANCELLED: 'bg-gray-500/20 text-gray-500 line-through',
};

function minutesLate(timeSlot: string): number {
  const now = new Date();
  const [h, m] = timeSlot.split(':').map(Number);
  const slot = new Date();
  slot.setHours(h, m, 0, 0);
  const diff = Math.floor((now.getTime() - slot.getTime()) / 60_000);
  return diff > 0 ? diff : 0;
}

function lateClass(mins: number): string {
  if (mins >= 30) return 'border-red-500 border-2';
  if (mins > 0)   return 'border-orange-400 border-2';
  return 'border-theme-border border';
}

/* ------------------------------------------------------------------ */
/*  Confirm Modal                                                      */
/* ------------------------------------------------------------------ */

function ConfirmModal({
  reservation,
  tables,
  onClose,
  onConfirm,
  isPending,
}: {
  reservation: Reservation;
  tables: Table[];
  onClose: () => void;
  onConfirm: (tableIds: string[]) => void;
  isPending: boolean;
}) {
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  const toggle = (id: string) => setSelectedTables((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-theme-surface rounded-theme p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-theme-text">Confirm Reservation</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-theme-text-muted mb-1">
          {reservation.customerName} — {reservation.partySize} guests at {reservation.timeSlot}
        </p>

        <label className="block text-sm font-semibold text-theme-text mt-4 mb-1">
          Assign Table(s)
        </label>
        <div className="bg-theme-bg border border-theme-border rounded-theme p-2 max-h-48 overflow-auto space-y-1 mb-2">
          {tables.map((t) => (
            <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-theme hover:bg-theme-surface cursor-pointer">
              <input type="checkbox" checked={selectedTables.includes(t.id)} onChange={() => toggle(t.id)} className="accent-orange-500" />
              <span className="text-sm text-theme-text">
                Table {t.tableNumber} <span className="text-theme-text-muted">(seats {t.capacity})</span>
                {t.status !== 'AVAILABLE' && <span className="text-yellow-500 ml-1 text-xs">[{t.status}]</span>}
              </span>
            </label>
          ))}
        </div>
        {selectedTables.length > 0 && (
          <p className="text-xs text-theme-text-muted mb-2">
            {selectedTables.length} table(s) — {tables.filter((t) => selectedTables.includes(t.id)).reduce((s, t) => s + t.capacity, 0)} seats total
          </p>
        )}

        <div className="flex gap-3 mt-4">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-theme border border-theme-border text-sm font-semibold text-theme-text-muted hover:bg-theme-bg transition-colors">
            Cancel
          </button>
          <button disabled={isPending} onClick={() => onConfirm(selectedTables)}
            className="flex-1 py-3 rounded-theme bg-theme-accent text-white text-sm font-semibold hover:bg-theme-accent-hover transition-colors disabled:opacity-50">
            {isPending ? 'Confirming...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reservation Card                                                   */
/* ------------------------------------------------------------------ */

function ReservationCard({
  r,
  onAction,
}: {
  r: Reservation;
  onAction: (action: string, id: string) => void;
}) {
  const late = r.status === 'CONFIRMED' ? minutesLate(r.timeSlot) : 0;
  const borderCls = r.status === 'CONFIRMED' && late > 0 ? lateClass(late) : 'border border-theme-border';

  return (
    <div className={`bg-theme-surface rounded-theme p-4 ${borderCls} flex flex-col gap-3`}>
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-theme-text-muted" />
          <span className="text-lg font-bold text-theme-text">{r.timeSlot}</span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-theme text-xs font-semibold ${STATUS_BADGE[r.status]}`}>
          {r.status.replace('_', ' ')}
        </span>
      </div>

      {/* Customer info */}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-theme-text">{r.customerName}</p>
        <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
          <Phone size={12} />
          <span>{r.customerPhone}</span>
        </div>
      </div>

      {/* Party + table */}
      <div className="flex items-center gap-4 text-xs text-theme-text-muted">
        <span className="flex items-center gap-1">
          <Users size={13} />
          {r.partySize} guest{r.partySize !== 1 ? 's' : ''}
        </span>
        {r.table && (
          <span className="bg-theme-bg px-2 py-0.5 rounded-theme font-medium">
            Table {r.table.tableNumber}
          </span>
        )}
      </div>

      {/* Late indicator */}
      {r.status === 'CONFIRMED' && late > 0 && (
        <p className={`text-xs font-semibold ${late >= 30 ? 'text-red-500' : 'text-orange-400'}`}>
          {late} min late
        </p>
      )}

      {/* Notes */}
      {r.notes && (
        <p className="text-xs text-theme-text-muted italic truncate">Note: {r.notes}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-1">
        {r.status === 'PENDING' && (
          <>
            <button
              onClick={() => onAction('confirm', r.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-theme bg-theme-accent text-white text-sm font-semibold hover:bg-theme-accent-hover transition-colors"
            >
              <Check size={16} /> Confirm
            </button>
            <button
              onClick={() => onAction('reject', r.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-theme bg-red-500/10 text-red-500 text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              <XCircle size={16} /> Reject
            </button>
          </>
        )}
        {r.status === 'CONFIRMED' && (
          <>
            <button
              onClick={() => onAction('arrived', r.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-theme bg-green-500/10 text-green-500 text-sm font-semibold hover:bg-green-500/20 transition-colors"
            >
              <UserCheck size={16} /> Arrived
            </button>
            <button
              onClick={() => onAction('no-show', r.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-theme bg-red-500/10 text-red-500 text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              <XCircle size={16} /> No-Show
            </button>
            <button
              onClick={() => onAction('cancel', r.id)}
              className="flex items-center justify-center gap-1 py-3 px-3 rounded-theme border border-theme-border text-theme-text-muted text-sm font-semibold hover:bg-theme-bg transition-colors"
            >
              <Ban size={14} />
            </button>
          </>
        )}
        {r.status === 'ARRIVED' && (
          <button
            onClick={() => onAction('completed', r.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-theme bg-theme-accent text-white text-sm font-semibold hover:bg-theme-accent-hover transition-colors"
          >
            <Check size={16} /> Complete
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

export default function PosReservationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [confirmTarget, setConfirmTarget] = useState<Reservation | null>(null);

  /* ---- Queries ---- */
  const {
    data: reservations = [],
    isLoading,
    refetch,
  } = useQuery<Reservation[]>({
    queryKey: ['pos-reservations', date],
    queryFn: () => api.get(`/reservations?date=${date}`),
    refetchInterval: 30_000,
  });

  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ['pos-tables'],
    queryFn: () => api.get('/tables'),
  });

  /* ---- Mutations ---- */
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pos-reservations'] });

  const confirmMut = useMutation({
    mutationFn: ({ id, tableIds }: { id: string; tableIds: string[] }) =>
      api.patch(`/reservations/${id}/confirm`, { tableIds }),
    onSuccess: () => { invalidate(); setConfirmTarget(null); },
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => api.patch(`/reservations/${id}/reject`, {}),
    onSuccess: invalidate,
  });

  const arrivedMut = useMutation({
    mutationFn: (id: string) => api.patch(`/reservations/${id}/arrived`, {}),
    onSuccess: invalidate,
  });

  const completedMut = useMutation({
    mutationFn: (id: string) => api.patch(`/reservations/${id}/completed`, {}),
    onSuccess: invalidate,
  });

  const noShowMut = useMutation({
    mutationFn: (id: string) => api.patch(`/reservations/${id}/no-show`, {}),
    onSuccess: invalidate,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/reservations/${id}/cancel`, {}),
    onSuccess: invalidate,
  });

  /* ---- Filtering ---- */
  const filtered = useMemo(() => {
    switch (tab) {
      case 'upcoming':
        return reservations.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED');
      case 'arrived':
        return reservations.filter((r) => r.status === 'ARRIVED');
      case 'all':
      default:
        return reservations;
    }
  }, [reservations, tab]);

  /* ---- Action dispatch ---- */
  function handleAction(action: string, id: string) {
    const r = reservations.find((res) => res.id === id);
    if (!r) return;

    switch (action) {
      case 'confirm':
        setConfirmTarget(r);
        break;
      case 'reject':
        rejectMut.mutate(id);
        break;
      case 'arrived':
        arrivedMut.mutate(id);
        break;
      case 'completed':
        completedMut.mutate(id);
        break;
      case 'no-show':
        noShowMut.mutate(id);
        break;
      case 'cancel':
        cancelMut.mutate(id);
        break;
    }
  }

  /* ---- Tab counts ---- */
  const upcomingCount = reservations.filter(
    (r) => r.status === 'PENDING' || r.status === 'CONFIRMED',
  ).length;
  const arrivedCount = reservations.filter((r) => r.status === 'ARRIVED').length;

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingCount },
    { key: 'arrived', label: 'Arrived', count: arrivedCount },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="h-full flex flex-col bg-theme-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border bg-theme-surface">
        <div className="flex items-center gap-3">
          <h1 className="font-theme-display text-xl text-theme-text">Bookings</h1>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-theme-bg rounded-theme px-3 py-1.5 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent"
          />
          {date !== toDateStr(new Date()) && (
            <button onClick={() => setDate(toDateStr(new Date()))} className="text-xs text-theme-accent hover:opacity-80">Today</button>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-4 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-theme text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'bg-theme-accent text-white'
                : 'bg-theme-surface text-theme-text-muted hover:bg-theme-bg border border-theme-border'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 text-xs opacity-80">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && (
          <p className="text-sm text-theme-text-muted text-center mt-12">Loading reservations...</p>
        )}

        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-theme-text-muted text-center mt-12">No reservations to show.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((r) => (
            <ReservationCard key={r.id} r={r} onAction={handleAction} />
          ))}
        </div>
      </div>

      {/* Confirm modal */}
      {confirmTarget && (
        <ConfirmModal
          reservation={confirmTarget}
          tables={tables}
          isPending={confirmMut.isPending}
          onClose={() => setConfirmTarget(null)}
          onConfirm={(tableIds) => confirmMut.mutate({ id: confirmTarget.id, tableIds })}
        />
      )}
    </div>
  );
}
