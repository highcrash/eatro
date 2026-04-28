import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X, Star, Upload, MessageSquare, Download, Pencil, Trash2 } from 'lucide-react';

import { formatCurrency, formatDateTime } from '@restora/utils';
import { api } from '../lib/api';

const CUSTOMER_CSV_EXAMPLE = `phone,name,email
01711000001,Alice,alice@example.com
01711000002,Bob,
01711000003,,charlie@example.com`;

function downloadCustomerCsvTemplate() {
  const blob = new Blob([CUSTOMER_CSV_EXAMPLE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'customers-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

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

interface SmsTemplate { id: string; name: string; body: string }

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('lastVisit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsBody, setSmsBody] = useState('');
  const [smsResult, setSmsResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [csvResult, setCsvResult] = useState<{ total: number; created: number; updated: number; skipped: number; results: Array<{ phone: string; status: string; reason?: string }> } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Edit / delete dialog state. `editing` carries the in-progress form;
  // `deleting` carries the customer the admin is about to soft-delete
  // (kept around so the confirm prompt can show the name).
  const [editing, setEditing] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; phone: string; email: string }>({ name: '', phone: '', email: '' });
  const [deleting, setDeleting] = useState<Customer | null>(null);

  const { data: templates = [] } = useQuery<SmsTemplate[]>({
    queryKey: ['sms', 'templates'],
    queryFn: () => api.get('/sms/templates'),
  });

  const bulkImportMut = useMutation({
    mutationFn: (items: Array<{ phone: string; name?: string; email?: string }>) =>
      api.post<{ total: number; created: number; updated: number; skipped: number; results: Array<{ phone: string; status: string; reason?: string }> }>('/customers/bulk', { items }),
    onSuccess: (data) => {
      setCsvResult(data);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: { id: string; name: string; phone: string; email: string }) =>
      api.patch<Customer>(`/customers/${data.id}`, {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer-detail'] });
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setDeleting(null);
      // If the removed customer was open in the detail modal, close it.
      setSelectedId((cur) => (cur === deleting?.id ? null : cur));
    },
  });

  const campaignMut = useMutation({
    mutationFn: (body: { customerIds: string[]; body: string }) =>
      api.post<{ sent: number; failed: number; skipped: number }>('/sms/campaigns', body),
    onSuccess: (data) => {
      setSmsResult(data);
      setChecked(new Set());
      setSmsBody('');
      setTimeout(() => { setSmsOpen(false); setSmsResult(null); }, 4000);
    },
  });

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.trim().split(/\r?\n/).map((r) => r.split(',').map((c) => c.trim()));
      if (rows.length < 2) { alert('CSV is empty'); return; }
      const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, ''));
      const phoneIdx = header.findIndex((h) => h === 'phone' || h === 'mobile' || h === 'contact');
      const nameIdx = header.findIndex((h) => h === 'name' || h === 'customer_name');
      const emailIdx = header.findIndex((h) => h === 'email');
      if (phoneIdx === -1) { alert('CSV must have a "phone" column'); return; }
      const items: Array<{ phone: string; name?: string; email?: string }> = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const phone = r[phoneIdx]?.trim();
        if (!phone) continue;
        items.push({
          phone,
          name: nameIdx >= 0 ? r[nameIdx]?.trim() || undefined : undefined,
          email: emailIdx >= 0 ? r[emailIdx]?.trim() || undefined : undefined,
        });
      }
      if (items.length === 0) { alert('No valid rows'); return; }
      bulkImportMut.mutate(items);
    };
    reader.readAsText(file);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-6 text-xs font-body text-[#666] mr-4">
            <span>{customers.length} customers</span>
            <span>Revenue: {formatCurrency(totalRevenue)}</span>
          </div>
          <button onClick={() => downloadCustomerCsvTemplate()} className="bg-[#161616] border border-[#2A2A2A] text-[#999] hover:text-white hover:border-[#666] font-body text-xs tracking-widest uppercase px-3 py-2 flex items-center gap-1.5 transition-colors" title="Download CSV template">
            <Download size={12} />
          </button>
          <button onClick={() => csvInputRef.current?.click()} className="bg-[#161616] border border-[#2A2A2A] text-[#999] hover:text-white hover:border-[#D62B2B] font-body text-xs tracking-widest uppercase px-3 py-2 flex items-center gap-1.5 transition-colors">
            <Upload size={12} /> CSV Import
          </button>
          <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
        </div>
      </div>

      {csvResult && (
        <div className="bg-[#161616] border border-[#2A2A2A] p-3 flex items-center justify-between">
          <div className="flex gap-4 text-xs font-body">
            <span className="text-[#4CAF50]">{csvResult.created} created</span>
            <span className="text-[#C8FF00]">{csvResult.updated} updated</span>
            <span className="text-[#FFA726]">{csvResult.skipped} skipped</span>
            <span className="text-[#666]">of {csvResult.total} total</span>
          </div>
          <button onClick={() => setCsvResult(null)} className="text-[#666] hover:text-white text-xs">Dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..."
            className="w-full bg-[#161616] border border-[#2A2A2A] pl-10 pr-4 py-2.5 text-sm font-body text-white outline-none focus:border-[#D62B2B] placeholder:text-[#555]" />
        </div>
        {checked.size > 0 && (
          <button onClick={() => setSmsOpen(true)} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-xs tracking-widest uppercase px-4 py-2 flex items-center gap-1.5">
            <MessageSquare size={12} /> Send SMS to {checked.size}
          </button>
        )}
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((c) => checked.has(c.id))}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) filtered.forEach((c) => next.add(c.id));
                    else filtered.forEach((c) => next.delete(c.id));
                    setChecked(next);
                  }}
                  className="accent-[#D62B2B]"
                />
              </th>
              <th className="px-5 py-3 font-medium"><SortBtn field="name" label="Name" /></th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium text-right"><SortBtn field="totalOrders" label="Orders" /></th>
              <th className="px-5 py-3 font-medium text-right"><SortBtn field="totalSpent" label="Total Spent" /></th>
              <th className="px-5 py-3 font-medium"><SortBtn field="lastVisit" label="Last Visit" /></th>
              <th className="px-5 py-3 font-medium">Joined</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-[#999]">No customers found</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className={`border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F] ${selectedId === c.id ? 'bg-[#1F1F1F]' : ''}`}>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={checked.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(c.id); else next.delete(c.id);
                      setChecked(next);
                    }}
                    className="accent-[#D62B2B]"
                  />
                </td>
                <td className="px-5 py-3 text-[#D62B2B] font-medium cursor-pointer" onClick={() => setSelectedId(c.id)}>{c.name}</td>
                <td className="px-5 py-3 text-[#999] cursor-pointer" onClick={() => setSelectedId(c.id)}>{c.phone}</td>
                <td className="px-5 py-3 text-[#999]">{c.email || '—'}</td>
                <td className="px-5 py-3 text-right text-white">{c.totalOrders}</td>
                <td className="px-5 py-3 text-right text-white">{formatCurrency(Number(c.totalSpent))}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{c.lastVisit ? formatDateTime(c.lastVisit) : '—'}</td>
                <td className="px-5 py-3 text-[#999] text-xs">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setEditing(c);
                      setEditForm({ name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '' });
                    }}
                    className="text-[#999] hover:text-white p-1.5 mr-1"
                    title="Edit customer"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => setDeleting(c)}
                    className="text-[#666] hover:text-[#F03535] p-1.5"
                    title="Delete customer"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
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

      {/* Edit customer dialog. Phone is mutable but the API rejects
          collisions inside the same branch with a friendly 400. */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !updateMut.isPending && setEditing(null)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-xl text-white tracking-widest">EDIT CUSTOMER</h3>
              <button onClick={() => setEditing(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Name</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Phone *</label>
                <input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Email</label>
                <input
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
            </div>
            {updateMut.error && (
              <p className="text-[#F03535] text-xs font-body mt-3">{(updateMut.error as Error).message}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditing(null)} disabled={updateMut.isPending} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5">Cancel</button>
              <button
                onClick={() => updateMut.mutate({ id: editing.id, ...editForm })}
                disabled={!editForm.name.trim() || !editForm.phone.trim() || updateMut.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm py-2.5 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm. Soft delete on the server — historical orders
          and reviews keep their customerId, so totals stay accurate;
          the row just disappears from POS + admin lists. */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleteMut.isPending && setDeleting(null)}>
          <div className="bg-[#161616] border border-[#F03535] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-[#F03535] tracking-widest mb-3">DELETE CUSTOMER</h3>
            <p className="text-[#DDD] font-body text-sm mb-2">
              Remove <span className="text-white font-medium">{deleting.name || 'Unnamed'}</span> ({deleting.phone}) from this branch?
            </p>
            <p className="text-[#999] font-body text-xs mb-5">
              Past orders and reviews stay intact and continue to count toward branch totals — only the customer entry itself is hidden.
            </p>
            {deleteMut.error && (
              <p className="text-[#F03535] text-xs font-body mb-3">{(deleteMut.error as Error).message}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setDeleting(null)} disabled={deleteMut.isPending} className="flex-1 bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-sm py-2.5">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleting.id)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-[#F03535] hover:bg-[#D62B2B] text-white font-body text-sm py-2.5 disabled:opacity-50"
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SMS campaign composer */}
      {smsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !campaignMut.isPending && setSmsOpen(false)}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-[#D62B2B]" />
              <h3 className="font-display text-xl text-white tracking-widest">SEND SMS TO {checked.size}</h3>
            </div>
            <p className="text-[#666] text-xs font-body">
              Placeholders: <code>{'{{name}}'}</code> (falls back to "Dear Customer"), <code>{'{{phone}}'}</code>
            </p>
            {templates.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs tracking-widest uppercase">Use template</label>
                <select
                  onChange={(e) => {
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t) setSmsBody(t.body);
                  }}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body"
                  defaultValue=""
                >
                  <option value="">— Pick a template —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs tracking-widest uppercase">Message</label>
              <textarea
                rows={6}
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Hi {{name}}, check out our new menu!"
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-mono"
              />
              <span className="text-[#666] text-[10px]">{smsBody.length} chars</span>
            </div>
            {smsResult && (
              <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-xs font-body">
                <span className="text-[#4CAF50] mr-3">{smsResult.sent} sent</span>
                <span className="text-[#F03535] mr-3">{smsResult.failed} failed</span>
                <span className="text-[#FFA726]">{smsResult.skipped} skipped</span>
              </div>
            )}
            {campaignMut.error && (
              <p className="text-[#F03535] text-xs">{(campaignMut.error as Error).message}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setSmsOpen(false)} disabled={campaignMut.isPending} className="flex-1 bg-[#2A2A2A] text-white py-2.5 text-sm">Cancel</button>
              <button
                onClick={() => campaignMut.mutate({ customerIds: Array.from(checked), body: smsBody })}
                disabled={!smsBody.trim() || campaignMut.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <MessageSquare size={12} /> {campaignMut.isPending ? 'Sending…' : `Send to ${checked.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
