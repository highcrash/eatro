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
