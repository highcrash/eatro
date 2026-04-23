import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

import type { Order } from '@restora/types';
import { formatElapsed, elapsedSeconds } from '@restora/utils';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';

let socket: Socket | null = null;

// Resolve the WS target against VITE_API_BASE_URL so the socket connects to
// the API origin, not the page's own host. Fixes cross-origin deployments
// where io('/ws') would target the POS domain instead of api.*.
function wsUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
  if (!base.startsWith('http')) return '/ws';
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}/ws`;
  } catch {
    return '/ws';
  }
}

function getSocket(): Socket {
  if (!socket) {
    socket = io(wsUrl(), { transports: ['websocket'] });
  }
  return socket;
}

export default function KitchenPage() {
  const { user } = useAuthStore();
  const branchId = user!.branchId;
  const [tickets, setTickets] = useState<Order[]>([]);
  const [preparingIds, setPreparingIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  // Fetch active orders on mount
  useEffect(() => {
    api
      .get<Order[]>('/orders?status=CONFIRMED,PREPARING')
      .then((orders) => {
        setTickets(orders);
        // Restore preparing state from DB
        setPreparingIds(new Set(orders.filter((o) => o.status === 'PREPARING').map((o) => o.id)));
      })
      .catch(() => {});
  }, []);

  // Socket.io: join KDS room and listen for events
  useEffect(() => {
    const s = getSocket();
    s.emit('join:kds', branchId);

    const onNew = (order: Order) =>
      setTickets((prev) => {
        if (prev.some((t) => t.id === order.id)) return prev;
        return [...prev, order];
      });

    const onDone = (orderId: string) =>
      setTickets((prev) => prev.filter((t) => t.id !== orderId));

    const onPreparing = (orderId: string) =>
      setPreparingIds((prev) => new Set(prev).add(orderId));

    s.on('kds:ticket:new', onNew);
    s.on('kds:ticket:done', onDone);
    s.on('kds:ticket:preparing', onPreparing);

    return () => {
      s.off('kds:ticket:new', onNew);
      s.off('kds:ticket:done', onDone);
      s.off('kds:ticket:preparing', onPreparing);
    };
  }, [branchId]);

  // 1-second tick for elapsed timers
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const markDone = useCallback((orderId: string) => {
    setTickets((prev) => prev.filter((t) => t.id !== orderId));
    setPreparingIds((prev) => {
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });
    getSocket().emit('kds:ticket:done', orderId);
  }, []);

  const startTicket = useCallback((orderId: string) => {
    setPreparingIds((prev) => new Set(prev).add(orderId));
    getSocket().emit('kds:ticket:preparing', orderId);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-[#DDD9D3] flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">
              Kitchen Display
            </span>
          </div>
          <h1 className="font-display text-[#111111] text-4xl tracking-wide">KITCHEN</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-body text-[#999]">
            {tickets.filter((t) => t.items.some((i) => !i.voidedAt && i.kitchenStatus !== 'PENDING_APPROVAL')).length} active
          </span>
        </div>
      </div>

      {/* Tickets Grid */}
      {tickets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#DDD9D3] font-display text-4xl tracking-widest">ALL CLEAR</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-3 gap-4 content-start">
            {tickets.map((ticket) => {
              const elapsed = elapsedSeconds(ticket.createdAt);
              const isUrgent = elapsed > 600;
              const isPreparing = preparingIds.has(ticket.id);
              const activeItems = ticket.items.filter((i) => !i.voidedAt && i.kitchenStatus !== 'PENDING_APPROVAL');

              // Hide tickets with no visible items (e.g. all items are PENDING_APPROVAL)
              if (activeItems.length === 0) return null;

              return (
                <div
                  key={ticket.id}
                  className={`border flex flex-col overflow-hidden bg-white ${
                    isPreparing
                      ? 'border-[#FFA726]'
                      : isUrgent
                        ? 'border-[#D62B2B]'
                        : 'border-[#DDD9D3]'
                  }`}
                >
                  {/* Ticket header */}
                  <div
                    className={`px-4 py-2.5 flex items-center justify-between ${
                      isPreparing
                        ? 'bg-[#FFA726]'
                        : isUrgent
                          ? 'bg-[#D62B2B]'
                          : 'bg-[#F2F1EE]'
                    }`}
                  >
                    <span
                      className={`font-display text-xl tracking-wide ${
                        isPreparing || isUrgent ? 'text-white' : 'text-[#111]'
                      }`}
                    >
                      #{ticket.orderNumber}
                    </span>
                    <span
                      className={`font-mono text-sm ${
                        isPreparing
                          ? 'text-white/80'
                          : isUrgent
                            ? 'text-white/80'
                            : 'text-[#D62B2B]'
                      }`}
                      suppressHydrationWarning
                    >
                      {formatElapsed(elapsed)}
                    </span>
                  </div>

                  {/* Table info */}
                  {(ticket.tableNumber || ticket.type === 'TAKEAWAY') && (
                    <div className="px-4 py-1.5 border-b border-[#DDD9D3] bg-[#FAF9F7]">
                      <span className="text-[#999] text-xs font-body tracking-widest uppercase">
                        {ticket.tableNumber ? `Table ${ticket.tableNumber}` : 'Takeaway'}
                      </span>
                    </div>
                  )}

                  {/* Items */}
                  <div className="flex-1 p-4 space-y-2">
                    {activeItems.map((item) => (
                      <div key={item.id} className="flex items-start gap-2">
                        <span className="font-display text-[#D62B2B] text-lg leading-none">
                          {item.quantity}&times;
                        </span>
                        <div className="flex-1">
                          <span className="text-[#111] text-sm font-body leading-tight">
                            {item.menuItemName}
                          </span>
                          {item.notes && (
                            <p className="text-[#999] text-xs font-body mt-0.5">{item.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex border-t border-[#DDD9D3]">
                    {isPreparing ? (
                      <button
                        onClick={() => markDone(ticket.id)}
                        className="flex-1 bg-[#FFA726] hover:bg-[#FFB74D] text-white py-2.5 text-xs font-body font-medium tracking-widest uppercase transition-colors"
                      >
                        DONE
                      </button>
                    ) : (
                      <button
                        onClick={() => startTicket(ticket.id)}
                        className="flex-1 bg-[#F2F1EE] hover:bg-[#FFA726] text-[#999] hover:text-white py-2.5 text-xs font-body font-medium tracking-widest uppercase transition-colors"
                      >
                        START
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
