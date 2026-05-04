import { io, Socket } from 'socket.io-client';

/**
 * Lazily-connected socket.io client for the QR app's realtime needs:
 *   - per-order room (`order:{id}`) for the multi-device share
 *     workflow events (`order:share-request` / `-approved` /
 *     `-denied`).
 *   - future: live `order:updated` so devices on the same order see
 *     each other's edits without waiting for the 3s status poll.
 *
 * Connection is shared across pages — page components subscribe via
 * `joinOrderRoom(orderId, handlers)` and unsubscribe in their effect
 * cleanup. We don't tear the socket down between page transitions
 * because reconnection would drop the room membership and miss
 * events fired in the gap.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENV = (import.meta as any).env ?? {};
const WS_URL = (ENV.VITE_WS_URL as string | undefined) ?? '/ws';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket) return socket;
  socket = io(WS_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export interface OrderRoomHandlers {
  onShareRequest?: (data: { orderId: string; deviceId: string; deviceLabel: string | null; expiresAt: number }) => void;
  onShareApproved?: (data: { orderId: string; deviceId: string }) => void;
  onShareDenied?: (data: { orderId: string; deviceId: string }) => void;
  onOrderUpdated?: (data: unknown) => void;
  /** Order:paid + order:items-pending share the same handler today —
   *  both just trigger a status-query invalidation in the QR app. */
  onOrderTerminal?: (data: unknown) => void;
}

/**
 * Subscribe to `order:{orderId}` events. Returns an unsubscribe
 * function the caller wires into the effect cleanup. Safe to call
 * multiple times for the same order — re-emits the join.
 */
export function joinOrderRoom(orderId: string, handlers: OrderRoomHandlers): () => void {
  const s = getSocket();
  s.emit('join:order', orderId);
  // Re-emit on reconnect so the room membership survives transient
  // network drops (mobile data → wifi handoff, lock-screen suspend).
  const onReconnect = (): void => { s.emit('join:order', orderId); };
  s.on('connect', onReconnect);

  const onShareRequest = handlers.onShareRequest ?? null;
  const onShareApproved = handlers.onShareApproved ?? null;
  const onShareDenied = handlers.onShareDenied ?? null;
  const onOrderUpdated = handlers.onOrderUpdated ?? null;
  const onOrderTerminal = handlers.onOrderTerminal ?? null;

  if (onShareRequest) s.on('order:share-request', onShareRequest);
  if (onShareApproved) s.on('order:share-approved', onShareApproved);
  if (onShareDenied) s.on('order:share-denied', onShareDenied);
  if (onOrderUpdated) s.on('order:updated', onOrderUpdated);
  if (onOrderTerminal) {
    s.on('order:paid', onOrderTerminal);
    s.on('order:items-pending', onOrderTerminal);
  }

  return () => {
    s.off('connect', onReconnect);
    if (onShareRequest) s.off('order:share-request', onShareRequest);
    if (onShareApproved) s.off('order:share-approved', onShareApproved);
    if (onShareDenied) s.off('order:share-denied', onShareDenied);
    if (onOrderUpdated) s.off('order:updated', onOrderUpdated);
    if (onOrderTerminal) {
      s.off('order:paid', onOrderTerminal);
      s.off('order:items-pending', onOrderTerminal);
    }
    // We deliberately don't `s.emit('leave:order', orderId)` —
    // socket.io's leaveAll on disconnect handles cleanup, and a
    // page-rerender that resubscribes shouldn't briefly miss events
    // due to a leave/rejoin race.
  };
}
