import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Reservation, ReservationSlot } from '@restora/types';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface DiningTable {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string;
}

type StatusFilter = 'ALL' | Reservation['status'];

/* ── Status badge colours ───────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'text-[#FFA726] bg-[#3a2e00]',
  CONFIRMED: 'text-[#29B6F6] bg-[#00243a]',
  ARRIVED:   'text-[#4CAF50] bg-[#1a3a1a]',
  COMPLETED: 'text-[#666] bg-[#2A2A2A]',
  NO_SHOW:   'text-[#D62B2B] bg-[#3a1a1a]',
  CANCELLED: 'text-[#666] bg-[#2A2A2A] line-through',
};

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Arrived', value: 'ARRIVED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'No-Show', value: 'NO_SHOW' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

/* ── Helpers ────────────────────────────────────────────────────────────── */

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isToday(dateStr: string): boolean {
  return dateStr === toDateStr(new Date());
}

/** Combine reservation date + timeSlot (HH:mm) into a Date object. */
function slotDateTime(res: Reservation): Date {
  return new Date(`${res.date}T${res.timeSlot}:00`);
}

/** Minutes elapsed since the reservation slot. Negative means future. */
function minutesLate(res: Reservation, now: Date): number {
  return Math.floor((now.getTime() - slotDateTime(res).getTime()) / 60_000);
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function ReservationsPage() {
  const qc = useQueryClient();

  // ── State ────────────────────────────────────────────────────────────
  const [date, setDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [now, setNow] = useState(new Date());

  // Confirm modal
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [confirmTableIds, setConfirmTableIds] = useState<string[]>([]);
  const [confirmTimeSlot, setConfirmTimeSlot] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');

  // Reject / cancel modals
  const [rejecting, setRejecting] = useState<Reservation | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // 30-second tick for "late" countdown
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: reservations = [], isLoading } = useQuery<Reservation[]>({
    queryKey: ['reservations', date, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      return api.get(`/reservations?${params}`);
    },
  });

  const { data: tables = [] } = useQuery<DiningTable[]>({
    queryKey: ['tables'],
    queryFn: () => api.get('/tables'),
  });

  // Slots for confirm modal (date-aware)
  const confirmDate = confirming?.date ? (typeof confirming.date === 'string' ? confirming.date.slice(0, 10) : new Date(confirming.date).toISOString().slice(0, 10)) : '';
  const { data: slots = [] } = useQuery<ReservationSlot[]>({
    queryKey: ['reservation-slots', confirmDate],
    queryFn: () =>
      api.get(`/reservations/public/slots?branchId=${confirming!.branchId}&date=${confirmDate}`),
    enabled: !!confirming,
  });

  // ── Filtered list ────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      reservations
        .slice()
        .sort((a, b) => (a.timeSlot < b.timeSlot ? -1 : 1)),
    [reservations],
  );

  // ── Suitable tables for confirm modal ────────────────────────────────
  // Show all tables (user can select multiple for large parties)
  const suitableTables = useMemo(
    () => confirming ? tables : [],
    [confirming, tables],
  );

  const availableSlots = useMemo(
    () => slots.filter((s) => !s.isFull),
    [slots],
  );

  // ── Mutations ────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reservations'] });

  const confirmMut = useMutation({
    mutationFn: (r: Reservation) =>
      api.patch(`/reservations/${r.id}/confirm`, {
        ...(confirmTableIds.length > 0 ? { tableIds: confirmTableIds } : {}),
        ...(confirmTimeSlot ? { timeSlot: confirmTimeSlot } : {}),
        ...(confirmNotes.trim() ? { notes: confirmNotes.trim() } : {}),
      }),
    onSuccess: () => { invalidate(); setConfirming(null); },
  });

  const rejectMut = useMutation({
    mutationFn: (r: Reservation) =>
      api.patch(`/reservations/${r.id}/reject`, {
        ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
      }),
    onSuccess: () => { invalidate(); setRejecting(null); },
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
    mutationFn: (r: Reservation) =>
      api.patch(`/reservations/${r.id}/cancel`, {
        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
      }),
    onSuccess: () => { invalidate(); setCancelling(null); },
  });

  // ── Helpers ──────────────────────────────────────────────────────────
  const openConfirm = (r: Reservation) => {
    setConfirmTableIds(r.tableIds ? JSON.parse(r.tableIds) : (r.tableId ? [r.tableId] : []));
    setConfirmTimeSlot('');
    setConfirmNotes(r.notes ?? '');
    setConfirming(r);
  };

  const openReject = (r: Reservation) => {
    setRejectReason('');
    setRejecting(r);
  };

  const openCancel = (r: Reservation) => {
    setCancelReason('');
    setCancelling(r);
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl tracking-widest text-white">RESERVATIONS</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-[#161616] border border-[#2A2A2A] text-white text-sm font-body px-3 py-1.5 focus:outline-none focus:border-[#D62B2B]"
          />
          {date && (
            <button onClick={() => setDate('')} className="text-[#999] hover:text-white font-body text-xs">All Dates</button>
          )}
          {!date && (
            <button onClick={() => setDate(toDateStr(new Date()))} className="text-[#FFA726] hover:text-white font-body text-xs">Today</button>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1 text-xs font-body tracking-wider uppercase transition-colors ${
              statusFilter === tab.value
                ? 'bg-[#D62B2B] text-white'
                : 'bg-[#161616] text-[#999] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[#666] font-body text-sm">No reservations found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#666] border-b border-[#2A2A2A]">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Customer</th>
                <th className="py-2 px-3">Phone</th>
                <th className="py-2 px-3 text-center">Party</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Table</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const late = r.status === 'CONFIRMED' && isToday(r.date) ? minutesLate(r, now) : null;
                const isLate = late !== null && late > 0;
                return (
                  <tr key={r.id} className="border-b border-[#1A1A1A] hover:bg-[#111]">
                    {/* Date */}
                    <td className="py-2.5 px-3 text-[#999]">{typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)}</td>
                    {/* Time */}
                    <td className="py-2.5 px-3 text-white">
                      {r.timeSlot}
                      {isLate && (
                        <span className="ml-2 text-[11px] inline-flex items-center gap-1">
                          <span
                            className="inline-block w-1.5 h-1.5"
                            style={{
                              backgroundColor: late! >= 30 ? '#D62B2B' : '#FFA726',
                              borderRadius: '50%',
                            }}
                          />
                          <span style={{ color: late! >= 30 ? '#D62B2B' : '#FFA726' }}>
                            {late} min late
                          </span>
                        </span>
                      )}
                    </td>

                    {/* Customer */}
                    <td className="py-2.5 px-3 text-white">{r.customerName}</td>

                    {/* Phone */}
                    <td className="py-2.5 px-3 text-[#999]">{r.customerPhone}</td>

                    {/* Party size */}
                    <td className="py-2.5 px-3 text-center text-white">{r.partySize}</td>

                    {/* Status badge */}
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_COLORS[r.status] ?? ''}`}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Table */}
                    <td className="py-2.5 px-3 text-[#999]">
                      {(() => {
                        if (r.tableIds) {
                          try {
                            const ids: string[] = JSON.parse(r.tableIds);
                            const nums = ids.map((tid) => tables.find((t) => t.id === tid)?.tableNumber).filter(Boolean);
                            return nums.length > 0 ? nums.map((n) => `#${n}`).join(', ') : '—';
                          } catch { /* */ }
                        }
                        return r.table ? `#${r.table.tableNumber}` : '—';
                      })()}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {r.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => openConfirm(r)}
                              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#00243a] text-[#29B6F6] hover:bg-[#003355] transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => openReject(r)}
                              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#3a1a1a] text-[#D62B2B] hover:bg-[#4a2020] transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === 'CONFIRMED' && (
                          <>
                            <button
                              onClick={() => arrivedMut.mutate(r.id)}
                              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#1a3a1a] text-[#4CAF50] hover:bg-[#255025] transition-colors"
                            >
                              Arrived
                            </button>
                            <button
                              onClick={() => noShowMut.mutate(r.id)}
                              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#3a1a1a] text-[#D62B2B] hover:bg-[#4a2020] transition-colors"
                            >
                              No Show
                            </button>
                            <button
                              onClick={() => openCancel(r)}
                              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#2A2A2A] text-[#666] hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {r.status === 'ARRIVED' && (
                          <button
                            onClick={() => completedMut.mutate(r.id)}
                            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#1a3a1a] text-[#4CAF50] hover:bg-[#255025] transition-colors"
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Confirm Modal ──────────────────────────────────────────────────── */}
      {confirming && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setConfirming(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg tracking-widest text-white mb-4">CONFIRM BOOKING</h2>

            <p className="text-sm font-body text-[#999] mb-4">
              {confirming.customerName} — Party of {confirming.partySize} — {confirming.timeSlot}
            </p>

            {/* Table selection (multiple) */}
            <label className="block text-[10px] font-body uppercase tracking-wider text-[#666] mb-1">
              Assign Table(s) — select one or more
            </label>
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-2 max-h-40 overflow-auto mb-3 space-y-1">
              {suitableTables.map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-[#1A1A1A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmTableIds.includes(t.id)}
                    onChange={() => setConfirmTableIds((prev) => prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                    className="accent-[#D62B2B]"
                  />
                  <span className="text-white font-body text-xs">
                    Table #{t.tableNumber} <span className="text-[#666]">(seats {t.capacity})</span>
                    {t.status !== 'AVAILABLE' && <span className="text-[#FFA726] ml-1">[{t.status}]</span>}
                  </span>
                </label>
              ))}
            </div>
            {confirmTableIds.length > 0 && (
              <p className="text-[#999] text-[10px] font-body mb-2">
                Selected: {confirmTableIds.length} table(s) — Total capacity: {tables.filter((t) => confirmTableIds.includes(t.id)).reduce((s, t) => s + t.capacity, 0)} seats
              </p>
            )}

            {/* Time slot change */}
            <label className="block text-[10px] font-body uppercase tracking-wider text-[#666] mb-1">
              Change Time Slot (optional)
            </label>
            <select
              value={confirmTimeSlot}
              onChange={(e) => setConfirmTimeSlot(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm font-body px-3 py-2 mb-3 focus:outline-none focus:border-[#D62B2B]"
            >
              <option value="">— Keep {confirming.timeSlot} —</option>
              {availableSlots.map((s) => (
                <option key={s.time} value={s.time}>
                  {s.time} ({s.availableBookings} bookings left, {s.availablePersons} persons left)
                </option>
              ))}
            </select>

            {/* Notes */}
            <label className="block text-[10px] font-body uppercase tracking-wider text-[#666] mb-1">
              Notes
            </label>
            <textarea
              value={confirmNotes}
              onChange={(e) => setConfirmNotes(e.target.value)}
              rows={3}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm font-body px-3 py-2 mb-4 resize-none focus:outline-none focus:border-[#D62B2B]"
              placeholder="Internal notes..."
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#2A2A2A] text-[#999] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmMut.mutate(confirming)}
                disabled={confirmMut.isPending}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#D62B2B] text-white hover:bg-[#B71C1C] transition-colors disabled:opacity-50"
              >
                {confirmMut.isPending ? 'Confirming...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ───────────────────────────────────────────────────── */}
      {rejecting && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setRejecting(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg tracking-widest text-white mb-4">REJECT BOOKING</h2>
            <p className="text-sm font-body text-[#999] mb-4">
              {rejecting.customerName} — {rejecting.timeSlot}
            </p>
            <label className="block text-[10px] font-body uppercase tracking-wider text-[#666] mb-1">
              Reason (optional)
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm font-body px-3 py-2 mb-4 resize-none focus:outline-none focus:border-[#D62B2B]"
              placeholder="Reason for rejection..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejecting(null)}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#2A2A2A] text-[#999] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMut.mutate(rejecting)}
                disabled={rejectMut.isPending}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#D62B2B] text-white hover:bg-[#B71C1C] transition-colors disabled:opacity-50"
              >
                {rejectMut.isPending ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Modal ───────────────────────────────────────────────────── */}
      {cancelling && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setCancelling(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg tracking-widest text-white mb-4">CANCEL BOOKING</h2>
            <p className="text-sm font-body text-[#999] mb-4">
              {cancelling.customerName} — {cancelling.timeSlot}
            </p>
            <label className="block text-[10px] font-body uppercase tracking-wider text-[#666] mb-1">
              Reason (optional)
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white text-sm font-body px-3 py-2 mb-4 resize-none focus:outline-none focus:border-[#D62B2B]"
              placeholder="Reason for cancellation..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelling(null)}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#2A2A2A] text-[#999] hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => cancelMut.mutate(cancelling)}
                disabled={cancelMut.isPending}
                className="px-4 py-1.5 text-xs font-body uppercase tracking-wider bg-[#D62B2B] text-white hover:bg-[#B71C1C] transition-colors disabled:opacity-50"
              >
                {cancelMut.isPending ? 'Cancelling...' : 'Cancel Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
