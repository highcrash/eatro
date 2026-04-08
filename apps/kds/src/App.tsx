import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

import type { Order, LoginResponse } from '@restora/types';
import { formatElapsed, elapsedSeconds } from '@restora/utils';
import { useAuthStore } from './store/auth.store';
import { api } from './lib/api';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io('/ws', { transports: ['websocket'] });
  }
  return socket;
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', { email, password });
      if (res.user.role !== 'KITCHEN' && res.user.role !== 'OWNER' && res.user.role !== 'MANAGER') {
        setError('Kitchen or manager credentials required');
        return;
      }
      setAuth(res.user, res.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-[#0D0D0D] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-[#D62B2B] flex items-center justify-center">
            <span className="font-display text-white text-lg tracking-wider">R</span>
          </div>
          <span className="font-display text-white text-2xl tracking-widest">KITCHEN DISPLAY</span>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
          </div>
          {error && <p className="text-[#F03535] text-xs font-body">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body font-medium text-sm py-3 transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── KDS Display ──────────────────────────────────────────────────────────────

function KdsDisplay() {
  const { user, clearAuth } = useAuthStore();
  const branchId = user!.branchId;
  const [tickets, setTickets] = useState<Order[]>([]);
  const [preparingIds, setPreparingIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const [clock, setClock] = useState(new Date());

  // Fetch existing active orders on mount
  useEffect(() => {
    api
      .get<Order[]>('/orders?status=CONFIRMED,PREPARING')
      .then((orders) => {
        setTickets(orders);
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

  // 1-second tick for elapsed timers + clock
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      setClock(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const markDone = useCallback((orderId: string) => {
    setTickets((prev) => prev.filter((t) => t.id !== orderId));
    setPreparingIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    getSocket().emit('kds:ticket:done', orderId);
  }, []);

  const startTicket = useCallback((orderId: string) => {
    setPreparingIds((prev) => new Set(prev).add(orderId));
    getSocket().emit('kds:ticket:preparing', orderId);
  }, []);

  const printTicket = useCallback((ticket: Order) => {
    const activeItems = ticket.items.filter((i) => !i.voidedAt);
    const items = activeItems
      .map(
        (i) =>
          `<tr><td style="padding:4px 0;font-size:16px;font-weight:bold">${i.quantity}\u00d7</td><td style="padding:4px 8px;font-size:16px">${i.menuItemName}</td></tr>${i.notes ? `<tr><td></td><td style="font-size:12px;color:#666;padding-bottom:4px">&nbsp;&rarr; ${i.notes}</td></tr>` : ''}`,
      )
      .join('');

    const html = `<html><head><style>
      body { font-family: monospace; width: 80mm; margin: 0; padding: 8px; }
      h1 { font-size: 24px; margin: 0; text-align: center; }
      .meta { font-size: 12px; text-align: center; color: #666; margin: 4px 0 12px; }
      table { width: 100%; border-collapse: collapse; }
      .divider { border-top: 1px dashed #000; margin: 8px 0; }
      .notes { font-size: 12px; font-style: italic; margin-top: 8px; }
    </style></head><body>
      <h1>KITCHEN ORDER</h1>
      <div class="meta">#${ticket.orderNumber} &mdash; ${ticket.tableNumber ? 'Table ' + ticket.tableNumber : ticket.type}</div>
      <div class="meta">${new Date(ticket.createdAt).toLocaleTimeString()}</div>
      <div class="divider"></div>
      <table>${items}</table>
      <div class="divider"></div>
      ${ticket.notes ? `<div class="notes">Note: ${ticket.notes}</div>` : ''}
      <script>window.onload=function(){window.print();window.close();}<\/script>
    </body></html>`;

    const win = window.open('', '_blank', 'width=320,height=600');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }, []);

  return (
    <div className="h-screen bg-[#0D0D0D] p-4 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#D62B2B] flex items-center justify-center">
            <span className="font-display text-white text-sm">R</span>
          </div>
          <span className="font-display text-white text-2xl tracking-widest">KITCHEN DISPLAY</span>
          <span className="text-[#2A2A2A] text-xs font-body ml-2">
            {tickets.filter((t) => t.items.some((i) => !i.voidedAt && i.kitchenStatus !== 'PENDING_APPROVAL')).length} tickets
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#666] text-xs font-mono" suppressHydrationWarning>
            {clock.toLocaleTimeString()}
          </span>
          <button
            onClick={clearAuth}
            className="text-[#2A2A2A] hover:text-[#D62B2B] text-xs font-body tracking-widest uppercase transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tickets */}
      {tickets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#2A2A2A] font-display text-5xl tracking-widest">ALL CLEAR</p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden content-start">
          {tickets.map((ticket) => {
            const elapsed = elapsedSeconds(ticket.createdAt);
            const isUrgent = elapsed > 600;
            const isPreparing = preparingIds.has(ticket.id);
            const activeItems = ticket.items.filter((i) => !i.voidedAt && i.kitchenStatus !== 'PENDING_APPROVAL');

            if (activeItems.length === 0) return null;

            return (
              <div
                key={ticket.id}
                className={`border flex flex-col overflow-hidden ${
                  isPreparing ? 'border-[#FFA726]' : isUrgent ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'
                } bg-[#161616]`}
              >
                {/* Ticket header */}
                <div className={`px-3 py-2 flex items-center justify-between ${
                  isPreparing ? 'bg-[#FFA726]' : isUrgent ? 'bg-[#D62B2B]' : 'bg-[#1F1F1F]'
                }`}>
                  <span className={`font-display text-xl tracking-wide ${isPreparing ? 'text-[#0D0D0D]' : 'text-white'}`}>
                    {ticket.orderNumber}
                  </span>
                  <span
                    className={`font-mono text-sm ${isPreparing ? 'text-[#0D0D0D]' : isUrgent ? 'text-white' : 'text-[#D62B2B]'}`}
                    suppressHydrationWarning
                  >
                    {formatElapsed(elapsed)}
                  </span>
                </div>

                {/* Table / type */}
                {(ticket.tableNumber || ticket.type === 'TAKEAWAY') && (
                  <div className="px-3 py-1 border-b border-[#2A2A2A]">
                    <span className="text-[#999] text-xs font-body tracking-widest uppercase">
                      {ticket.tableNumber ? `Table ${ticket.tableNumber}` : 'Takeaway'}
                    </span>
                  </div>
                )}

                {/* Items */}
                <div className="flex-1 overflow-auto p-3 space-y-2">
                  {activeItems.map((item) => (
                    <div key={item.id} className="flex items-start gap-2">
                      <span className="font-display text-[#D62B2B] text-lg leading-none">
                        {item.quantity}×
                      </span>
                      <div className="flex-1">
                        <span className="text-white text-sm font-body leading-tight">
                          {item.menuItemName}
                        </span>
                        {item.notes && (
                          <p className="text-[#666] text-xs font-body mt-0.5">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Print / Start / Done buttons */}
                <div className="flex border-t border-[#2A2A2A]">
                  <button
                    onClick={() => printTicket(ticket)}
                    className="px-3 py-2.5 text-xs font-body font-medium tracking-widest uppercase transition-colors border-r border-[#2A2A2A] bg-[#1F1F1F] hover:bg-[#333] text-[#999] hover:text-white"
                    title="Print ticket"
                  >
                    PRINT
                  </button>
                  {isPreparing ? (
                    <button
                      onClick={() => markDone(ticket.id)}
                      className="flex-1 bg-[#FFA726] hover:bg-[#FFB74D] text-[#0D0D0D] py-2.5 text-xs font-body font-medium tracking-widest uppercase transition-colors"
                    >
                      DONE
                    </button>
                  ) : (
                    <button
                      onClick={() => startTicket(ticket.id)}
                      className="flex-1 bg-[#1F1F1F] hover:bg-[#FFA726] text-[#999] hover:text-[#0D0D0D] py-2.5 text-xs font-body font-medium tracking-widest uppercase transition-colors"
                    >
                      START
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function KdsApp() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) return <LoginScreen />;
  return <KdsDisplay />;
}
