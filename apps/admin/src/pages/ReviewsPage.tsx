import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Search, Star } from 'lucide-react';
import { api } from '../lib/api';

interface AdminReview {
  id: string;
  foodScore: number;
  serviceScore: number;
  atmosphereScore: number;
  priceScore: number;
  notes: string | null;
  isHidden: boolean;
  createdAt: string;
  customer: { id: string; name: string; phone: string } | null;
  order: { id: string; orderNumber: string; totalAmount: number } | null;
}

type Filter = 'all' | 'visible' | 'hidden';

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data: reviews = [], isLoading } = useQuery<AdminReview[]>({
    queryKey: ['admin-reviews'],
    queryFn: () => api.get('/customers/reviews/all'),
  });

  const setVisibility = useMutation({
    mutationFn: (vars: { id: string; isHidden: boolean }) =>
      api.patch(`/customers/reviews/${vars.id}/visibility`, { isHidden: vars.isHidden }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reviews.filter((r) => {
      if (filter === 'visible' && r.isHidden) return false;
      if (filter === 'hidden' && !r.isHidden) return false;
      if (!needle) return true;
      const hay = [
        r.customer?.name ?? '',
        r.customer?.phone ?? '',
        r.order?.orderNumber ?? '',
        r.notes ?? '',
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [reviews, q, filter]);

  const stats = useMemo(() => {
    const total = reviews.length;
    const hidden = reviews.filter((r) => r.isHidden).length;
    const visible = total - hidden;
    const avg = total === 0 ? 0 :
      reviews.reduce((s, r) => s + (r.foodScore + r.serviceScore + r.atmosphereScore + r.priceScore) / 4, 0) / total;
    return { total, hidden, visible, avg };
  }, [reviews]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">REVIEWS</h1>
          <p className="text-xs text-[#999] mt-1">
            Customer reviews from paid orders. Hide one to suppress it on the public website without deleting it.
          </p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer, order, notes…"
            className="bg-[#161616] border border-[#2A2A2A] text-white pl-9 pr-3 py-2 text-sm w-72 focus:outline-none focus:border-[#D62B2B]"
          />
        </div>
        <div className="inline-flex border border-[#2A2A2A]">
          {(['all', 'visible', 'hidden'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs uppercase tracking-widest ${filter === f ? 'bg-[#D62B2B] text-white' : 'bg-[#161616] text-[#999] hover:text-white'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total reviews" value={String(stats.total)} />
        <Tile label="Visible on website" value={String(stats.visible)} tone="gain" />
        <Tile label="Hidden" value={String(stats.hidden)} tone={stats.hidden > 0 ? 'loss' : undefined} />
        <Tile label="Average rating" value={`${stats.avg.toFixed(1)} / 5`} />
      </div>

      <div className="border border-[#2A2A2A]">
        {isLoading && <p className="text-[#999] text-sm p-4">Loading…</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-[#666] text-sm p-8 text-center">
            {reviews.length === 0 ? 'No reviews yet.' : 'No reviews match the filter.'}
          </p>
        )}
        {filtered.map((r) => {
          const avg = (r.foodScore + r.serviceScore + r.atmosphereScore + r.priceScore) / 4;
          return (
            <div
              key={r.id}
              className={`border-b border-[#2A2A2A] p-4 flex flex-wrap items-start gap-4 ${r.isHidden ? 'bg-[#0a0a0a] opacity-60' : 'bg-[#0d0d0d]'}`}
            >
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-white font-medium">{r.customer?.name ?? 'Anonymous'}</span>
                  {r.customer?.phone && <span className="text-[10px] text-[#666]">{r.customer.phone}</span>}
                  {r.order?.orderNumber && <span className="text-[10px] font-mono text-[#666]">#{r.order.orderNumber}</span>}
                  {r.isHidden && (
                    <span className="text-[10px] uppercase tracking-widest border border-[#FFA726] text-[#FFA726] px-2 py-0.5">Hidden</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Stars n={Math.round(avg)} />
                  <span className="text-[11px] text-[#999]">{avg.toFixed(1)} avg</span>
                </div>
                <div className="grid grid-cols-4 gap-3 max-w-md mb-2">
                  {(['Food', 'Service', 'Atmosphere', 'Price'] as const).map((label, i) => {
                    const score = [r.foodScore, r.serviceScore, r.atmosphereScore, r.priceScore][i];
                    return (
                      <div key={label} className="text-[10px] text-[#888] uppercase tracking-widest">
                        {label}: <span className="text-[#DDD9D3]">{score}/5</span>
                      </div>
                    );
                  })}
                </div>
                {r.notes && <p className="text-sm text-[#DDD9D3] mt-2 italic">"{r.notes}"</p>}
                <p className="text-[10px] text-[#666] mt-2">{new Date(r.createdAt).toLocaleString()}</p>
              </div>
              <button
                onClick={() => setVisibility.mutate({ id: r.id, isHidden: !r.isHidden })}
                disabled={setVisibility.isPending}
                className={`flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-widest border ${r.isHidden ? 'border-[#4CAF50] text-[#4CAF50] hover:bg-[#4CAF50] hover:text-white' : 'border-[#FFA726] text-[#FFA726] hover:bg-[#FFA726] hover:text-black'} disabled:opacity-50`}
              >
                {r.isHidden ? <><Eye size={12} /> Show on website</> : <><EyeOff size={12} /> Hide from website</>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const colour = tone === 'gain' ? 'text-[#4CAF50]' : tone === 'loss' ? 'text-[#FFA726]' : 'text-white';
  return (
    <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-[#888]">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colour}`}>{value}</p>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= n ? 'fill-[#FFA726] text-[#FFA726]' : 'text-[#2A2A2A]'} />
      ))}
    </div>
  );
}
