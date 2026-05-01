import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Scheduled Facebook posts queue, shown as a tab inside DiscountsPage.
 *
 * Lists every ScheduledFbPost the branch has ever queued. Per row:
 *   - Image thumbnail (loads via /social/scheduled/:id/preview).
 *   - Item name + scheduled date.
 *   - Status badge (PENDING / POSTED / CANCELLED / FAILED).
 *   - Actions: Reschedule, Post Now, Cancel — gated on status.
 */

interface ScheduledPost {
  id: string;
  branchId: string;
  menuDiscountId: string | null;
  status: 'PENDING' | 'POSTED' | 'CANCELLED' | 'FAILED';
  scheduledAt: string;
  postedAt: string | null;
  fbPostId: string | null;
  message: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  menuDiscount?: {
    id: string;
    type: string;
    value: number;
    menuItem?: { id: string; name: string };
  } | null;
}

const STATUS_STYLE: Record<ScheduledPost['status'], string> = {
  PENDING: 'bg-[#FFA726]/15 text-[#FFA726]',
  POSTED: 'bg-[#4CAF50]/15 text-[#4CAF50]',
  CANCELLED: 'bg-[#666]/20 text-[#999]',
  FAILED: 'bg-[#D62B2B]/15 text-[#D62B2B]',
};

function fmt(dt: string | null): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

function PreviewImage({ id }: { id: string }) {
  // Browser caches the preview; the URL itself is the cache key. We
  // fetch via the auth-guarded JSON helper, but the route returns
  // raw bytes — convert to a blob URL for <img>.
  const { data: src } = useQuery<string | null>({
    queryKey: ['fb-preview', id],
    queryFn: async () => {
      try {
        const blob = await api.getBlob(`/social/scheduled/${id}/preview`);
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  if (!src) {
    return <div className="w-16 h-20 bg-[#222] flex items-center justify-center text-[10px] text-[#666]">…</div>;
  }
  return <img src={src} alt="" className="w-16 h-20 object-cover" />;
}

export default function ScheduledPostsPanel() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: posts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ['fb-scheduled', statusFilter],
    queryFn: () => api.get(`/social/scheduled${statusFilter ? `?status=${statusFilter}` : ''}`),
    refetchInterval: 30_000,
  });

  const [rescheduling, setRescheduling] = useState<{ id: string; current: string } | null>(null);
  const [newDate, setNewDate] = useState('');

  const reschedMut = useMutation({
    mutationFn: (dto: { id: string; scheduledAt: string }) =>
      api.patch(`/social/scheduled/${dto.id}`, { scheduledAt: dto.scheduledAt }),
    onSuccess: () => {
      setRescheduling(null);
      void qc.invalidateQueries({ queryKey: ['fb-scheduled'] });
    },
  });

  const postNowMut = useMutation({
    mutationFn: (id: string) => api.post(`/social/scheduled/${id}/post-now`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fb-scheduled'] }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.delete(`/social/scheduled/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fb-scheduled'] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#999] font-body">
          Auto-generated posts from menu discounts. Cron runs every minute — PENDING posts fire when their scheduled time arrives.
        </p>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0D0D0D] border border-[#2A2A2A] text-white text-xs px-3 py-2 font-body focus:outline-none focus:border-[#D62B2B]"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="POSTED">Posted</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium w-20">Preview</th>
              <th className="px-5 py-3 font-medium">Item</th>
              <th className="px-5 py-3 font-medium">Scheduled</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium w-72">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => {
              const itemName = p.menuDiscount?.menuItem?.name ?? '(deleted item)';
              const isPending = p.status === 'PENDING';
              const isFailed = p.status === 'FAILED';
              const isPosted = p.status === 'POSTED';
              return (
                <tr key={p.id} className="border-b border-[#2A2A2A] last:border-0 align-top">
                  <td className="px-5 py-3">
                    <PreviewImage id={p.id} />
                  </td>
                  <td className="px-5 py-3 text-white">
                    <div className="font-medium">{itemName}</div>
                    {p.menuDiscount && (
                      <div className="text-[10px] text-[#666] font-mono mt-0.5">
                        {p.menuDiscount.type === 'PERCENTAGE'
                          ? `${Number(p.menuDiscount.value)}% off`
                          : `৳${Number(p.menuDiscount.value) / 100} off`}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#DDD9D3]">
                    <div>{fmt(p.scheduledAt)}</div>
                    {p.postedAt && (
                      <div className="text-[10px] text-[#666] font-body mt-0.5">
                        Posted: {fmt(p.postedAt)}
                      </div>
                    )}
                    {p.lastError && (
                      <div className="text-[10px] text-[#D62B2B] font-body mt-0.5 max-w-xs truncate" title={p.lastError}>
                        {p.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] px-2 py-1 font-body uppercase tracking-widest ${STATUS_STYLE[p.status]}`}>
                      {p.status}
                    </span>
                    {p.attempts > 0 && (
                      <div className="text-[10px] text-[#666] font-body mt-1">
                        Attempts: {p.attempts}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 space-x-2 text-xs">
                    {(isPending || isFailed) && (
                      <button
                        onClick={() => postNowMut.mutate(p.id)}
                        disabled={postNowMut.isPending}
                        className="text-[#4CAF50] hover:underline disabled:opacity-40"
                      >
                        Post Now
                      </button>
                    )}
                    {isPending && (
                      <>
                        <button
                          onClick={() => {
                            setRescheduling({ id: p.id, current: p.scheduledAt });
                            setNewDate(p.scheduledAt.slice(0, 16));
                          }}
                          className="text-[#FFA726] hover:underline"
                        >
                          Reschedule
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Cancel this scheduled post?')) cancelMut.mutate(p.id);
                          }}
                          className="text-[#D62B2B] hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {isPosted && p.fbPostId && (
                      <a
                        href={`https://www.facebook.com/${p.fbPostId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#4CAF50] hover:underline"
                      >
                        View on FB ↗
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {posts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-[#999]">No scheduled posts.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rescheduling && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setRescheduling(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg text-white tracking-widest uppercase">Reschedule Post</h2>
            <input
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            />
            <div className="flex gap-2">
              <button onClick={() => setRescheduling(null)} className="flex-1 border border-[#2A2A2A] text-[#999] py-2 font-body text-xs uppercase tracking-widest">
                Cancel
              </button>
              <button
                onClick={() => reschedMut.mutate({ id: rescheduling.id, scheduledAt: new Date(newDate).toISOString() })}
                disabled={!newDate || reschedMut.isPending}
                className="flex-1 bg-[#D62B2B] text-white py-2 font-body text-xs uppercase tracking-widest disabled:opacity-40"
              >
                {reschedMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
