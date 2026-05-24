import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

import { api } from '../lib/api';
import type { ShoppingRequest, ShoppingRequestStatus } from '@restora/types';

/**
 * Mobile history page — list of the current staff's own submitted
 * requests with a status pill and per-line summary. KITCHEN role is
 * restricted server-side to own-only via the JWT, so we don't need
 * to filter client-side. Admin roles also see their own when they
 * use the mobile flow — request list is `mineOnly=1`.
 */
export default function MobileShoppingHistoryPage() {
  const { data: requests = [], isLoading } = useQuery<ShoppingRequest[]>({
    queryKey: ['shopping-requests-mine'],
    queryFn: () => api.get<ShoppingRequest[]>('/shopping-requests?mineOnly=1'),
  });

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white pb-16">
      <header className="sticky top-0 z-30 bg-[#0D0D0D]/95 backdrop-blur border-b border-[#2A2A2A] px-4 py-3 flex items-center gap-3">
        <Link to="/mobile/shopping" className="text-[#999] hover:text-white">
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="font-display text-xl tracking-widest">MY REQUESTS</h1>
          <p className="text-[10px] text-[#888] uppercase tracking-widest">{requests.length} total</p>
        </div>
      </header>

      <main className="px-4 py-3 space-y-3">
        {isLoading && <p className="text-[#666] text-sm text-center py-8">Loading…</p>}
        {!isLoading && requests.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[#666] text-sm">No requests yet.</p>
            <Link to="/mobile/shopping" className="inline-block mt-3 text-[#D62B2B] text-sm tracking-widest uppercase">
              + Create one
            </Link>
          </div>
        )}
        {requests.map((req) => (
          <RequestCard key={req.id} request={req} />
        ))}
      </main>
    </div>
  );
}

const STATUS_PILL: Record<ShoppingRequestStatus, { bg: string; text: string; label: string; Icon: typeof Clock }> = {
  PENDING: { bg: 'bg-[#3a2e00]', text: 'text-[#FFA726]', label: 'Pending', Icon: Clock },
  APPROVED: { bg: 'bg-[#1a3a1a]', text: 'text-[#4CAF50]', label: 'Approved', Icon: CheckCircle2 },
  REJECTED: { bg: 'bg-[#3a1a1a]', text: 'text-[#D62B2B]', label: 'Rejected', Icon: XCircle },
};

function RequestCard({ request }: { request: ShoppingRequest }) {
  const { bg, text, label, Icon } = STATUS_PILL[request.status];
  const mismatchCount = request.lines.filter((l) => l.mismatchReason).length;
  const orderLines = request.lines.filter((l) => (l.requestedQuantity ?? 0) > 0).length;

  return (
    <div className="bg-[#161616] border border-[#2A2A2A] p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-[#666] uppercase tracking-widest">#{request.id.slice(-6)}</p>
          <p className="text-xs text-[#999] mt-0.5">
            {new Date(request.createdAt).toLocaleString('en-GB', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
        <span className={`${bg} ${text} text-[10px] tracking-widest uppercase px-2 py-1 flex items-center gap-1`}>
          <Icon size={10} /> {label}
        </span>
      </div>

      <div className="text-xs text-[#ccc]">
        <span className="text-white font-bold">{request.lines.length}</span> line{request.lines.length === 1 ? '' : 's'}
        {' · '}
        <span className="text-[#4CAF50]">{orderLines} order</span>
        {mismatchCount > 0 && (
          <>
            {' · '}
            <span className="text-[#FFA726] inline-flex items-center gap-1">
              <AlertTriangle size={10} /> {mismatchCount} mismatch
            </span>
          </>
        )}
      </div>

      {request.notes && (
        <p className="text-xs text-[#888] italic">"{request.notes}"</p>
      )}

      {request.status === 'REJECTED' && request.rejectionReason && (
        <div className="bg-[#3a1a1a] border border-[#D62B2B] text-[#F03535] text-xs p-2">
          {request.rejectionReason}
        </div>
      )}
    </div>
  );
}
