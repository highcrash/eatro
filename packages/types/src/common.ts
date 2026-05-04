// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// ─── Audit Fields ─────────────────────────────────────────────────────────────

export interface AuditFields {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─── Currency & Quantity ──────────────────────────────────────────────────────

/** Monetary value stored as smallest unit (paisa for BDT) — use Decimal(14,2) in DB */
export type MoneyAmount = number;

/** Quantity with 4 decimal precision for sub-gram/sub-ml accuracy */
export type Quantity = number;

// ─── WebSocket Events ────────────────────────────────────────────────────────

export type WsEvent =
  | 'order:created'
  | 'order:updated'
  | 'order:cancelled'
  | 'order:paid'
  | 'order:items-pending'
  /** Multi-device QR share workflow: a second device asked to join an
   *  existing order. Emitted to room `order:{id}` so the primary
   *  device (already in that room) renders the approve/deny popup. */
  | 'order:share-request'
  /** Primary device approved a share request. Server has added the
   *  requesting device to `Order.sharedDeviceIds`. Emitted to
   *  `order:{id}` so the requesting device drops out of read-only
   *  mode and starts editing. */
  | 'order:share-approved'
  /** Primary device denied a share request, OR the request expired
   *  (60s timeout). Emitted to `order:{id}` so the requesting device
   *  surfaces the rejection toast. */
  | 'order:share-denied'
  | 'table:updated'
  | 'kds:ticket:new'
  | 'kds:ticket:done'
  | 'kds:ticket:recalled'
  | 'kds:ticket:preparing'
  | 'stock:low'
  | 'bill:requested'
  | 'reservation:created'
  | 'reservation:updated'
  | 'reservation:cancelled';
