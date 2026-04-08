import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Star } from 'lucide-react';

import { formatCurrency, formatDateTime } from '@restora/utils';
import { api } from '../lib/api';

interface Customer {
  id: string; phone: string; name: string; email: string | null;
  totalOrders: number; totalSpent: number; lastVisit: string | null; createdAt: string;
}

interface CustomerDetail {
  customer: Customer;
  orders: { id: string; orderNumber: string; status: string; totalAmount: number; createdAt: string; items: { menuItemName: string; quantity: number }[]; review?: { foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes: string | null } | null }[];
  reviews: { id: string; foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes: string | null; createdAt: string }[];
}

type SortField = 'name' | 'totalSpent' | 'totalOrders' | 'lastVisit';

function StarRating({ score }: { score: number }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={10} className={i <= score ? 'text-[#C8FF00] fill-[#C8FF00]' : 'text-[#2A2A2A]'} />
      ))}
    </span>
  );
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('lastVisit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers'),
  });

  const { data: detail } = useQuery<CustomerDetail>({
    queryKey: ['customer-detail', selectedId],
    queryFn: () => api.get(`/customers/${selectedId}/detail`),
    enabled: !!selectedId,
  });

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    let result = customers;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
    }
    result = [...result].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortBy === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (sortBy === 'totalSpent') { av = Number(a.totalSpent); bv = Number(b.totalSpent); }
      else if (sortBy === 'totalOrders') { av = a.totalOrders; bv = b.totalOrders; }
      else { av = a.lastVisit ? new Date(a.lastVisit).getTime() : 0; bv = b.lastVisit ? new Date(b.lastVisit).getTime() : 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [customers, search, sortBy, sortDir]);

  const totalRevenue = customers.reduce((s, c) => s + Number(c.totalSpent), 0);

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1">
      {label}
      {sortBy === field && <span className="text-[#D62B2B]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">CRM</p>
          <h1 className="font-display text-4xl text-white tracking-wide">CUSTOMERS</h1>
        </div>
        <div className="flex items-center gap-6 text-xs font-body text-[#666]">
          <span>{customers.length} customers</span>
          <span>Revenue: {formatCurrency(totalRevenue)}</span>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..."
          className="w-full bg-[#161616] border border-[#2A2A2A] pl-10 pr-4 py-2.5 text-sm font-body text-white outline-none focus:border-[#D62B2B] placeholder:text-[#555]" />
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium"><SortBtn field="name" label="Name" /></th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium text-right"><SortBtn field="totalOrders" label="Orders" /></th>
              <th className="px-5 py-3 font-medium text-right"><SortBtn field="totalSpent" label="Total Spent" /></th>
              <th className="px-5 py-3 font-medium"><SortBtn field="lastVisit" label="Last Visit" /></th>
              <th className="px-5 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-[#999]">No customers found</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className={`border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F] cursor-pointer ${selectedId === c.id ? 'bg-[#1F1F1F]' : ''}`} onClick={() => setSelectedId(c.id)}>
                <td className="px-5 py-3 text-[#D62B2B] font-medium">{c.name}</td>
                <td className="px-5 py-3 text-[#999]">{c.phone}</td>
                <td className="px-5 py-3 text-[#999]">{c.email || '—'}</td>
                <td className="px-5 py-3 text-right text-white">{c.totalOrders}</td>
                <td className="px-5 py-3 text-right text-white">{formatCurrency(Number(c.totalSpent))}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{c.lastVisit ? formatDateTime(c.lastVisit) : '—'}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Customer Detail Modal */}
      {selectedId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSelectedId(null)}>
          <div className="bg-[#161616] w-[700px] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[#161616] px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between z-10">
              <div>
                <h3 className="font-display text-2xl text-white tracking-wide">{detail.customer.name}</h3>
                <p className="text-xs font-body text-[#666] mt-0.5">{detail.customer.phone} {detail.customer.email ? `• ${detail.customer.email}` : ''}</p>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
            </div>

            {/* Stats */}
            <div className="px-6 py-4 grid grid-cols-4 gap-4">
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-center">
                <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Orders</p>
                <p className="font-display text-xl text-white">{detail.customer.totalOrders}</p>
              </div>
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-center">
                <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Spent</p>
                <p className="font-display text-xl text-white">{formatCurrency(Number(detail.customer.totalSpent))}</p>
              </div>
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-center">
                <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Last Visit</p>
                <p className="text-xs font-body text-white mt-1">{detail.customer.lastVisit ? formatDateTime(detail.customer.lastVisit) : '—'}</p>
              </div>
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-center">
                <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">Avg. Review</p>
                <p className="font-display text-xl text-[#C8FF00]">
                  {detail.reviews.length > 0 ? (detail.reviews.reduce((s, r) => s + (r.foodScore + r.serviceScore + r.atmosphereScore + r.priceScore) / 4, 0) / detail.reviews.length).toFixed(1) : '—'}
                </p>
              </div>
            </div>

            {/* Order History */}
            <div className="px-6 py-4">
              <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-3">Order History ({detail.orders.length})</p>
              <div className="space-y-2 max-h-60 overflow-auto">
                {detail.orders.map((o) => (
                  <div key={o.id} className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-body text-white font-medium">{o.orderNumber}</span>
                        <span className={`text-[9px] font-body tracking-widest uppercase ${o.status === 'PAID' ? 'text-green-500' : o.status === 'VOID' ? 'text-[#D62B2B]' : 'text-[#999]'}`}>{o.status}</span>
                      </div>
                      <p className="text-[10px] font-body text-[#666] mt-0.5">
                        {o.items.map((i) => `${i.quantity}× ${i.menuItemName}`).join(', ')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-sm font-body font-medium text-white">{formatCurrency(Number(o.totalAmount))}</p>
                      <p className="text-[10px] font-body text-[#666]">{formatDateTime(o.createdAt)}</p>
                    </div>
                    {o.review && (
                      <div className="ml-3 flex-shrink-0">
                        <StarRating score={Math.round((o.review.foodScore + o.review.serviceScore + o.review.atmosphereScore + o.review.priceScore) / 4)} />
                      </div>
                    )}
                  </div>
                ))}
                {detail.orders.length === 0 && <p className="text-[#666] font-body text-xs text-center py-4">No orders yet</p>}
              </div>
            </div>

            {/* Reviews */}
            {detail.reviews.length > 0 && (
              <div className="px-6 py-4 border-t border-[#2A2A2A]">
                <p className="text-[10px] font-body text-[#666] tracking-widest uppercase mb-3">Reviews ({detail.reviews.length})</p>
                <div className="space-y-2">
                  {detail.reviews.map((r) => (
                    <div key={r.id} className="bg-[#0D0D0D] border border-[#2A2A2A] p-3">
                      <div className="grid grid-cols-4 gap-3 mb-2">
                        {[
                          { label: 'Food', score: r.foodScore },
                          { label: 'Service', score: r.serviceScore },
                          { label: 'Atmosphere', score: r.atmosphereScore },
                          { label: 'Price', score: r.priceScore },
                        ].map((s) => (
                          <div key={s.label} className="text-center">
                            <p className="text-[9px] font-body text-[#666] tracking-widest uppercase">{s.label}</p>
                            <StarRating score={s.score} />
                          </div>
                        ))}
                      </div>
                      {r.notes && <p className="text-xs font-body text-[#999] italic">"{r.notes}"</p>}
                      <p className="text-[9px] font-body text-[#555] mt-1">{formatDateTime(r.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
