import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Phone, Mail, X } from 'lucide-react';

import { formatCurrency, formatDateTime } from '@restora/utils';
import { api } from '../lib/api';

interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  totalOrders: number;
  totalSpent: number;
  lastVisit: string | null;
  createdAt: string;
}

export default function PosCustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState('');

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['pos-customers'],
    queryFn: () => api.get('/customers'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  const selected = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId],
  );

  const createMut = useMutation({
    mutationFn: (dto: { name: string; phone: string; email?: string }) =>
      api.post<Customer>('/customers', dto),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['pos-customers'] });
      setShowAdd(false);
      setNewCust({ name: '', phone: '', email: '' });
      setSelectedId(c.id);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="h-full flex bg-theme-bg">
      {/* List */}
      <div className="w-96 flex flex-col border-r border-theme-border bg-theme-surface">
        <div className="p-4 border-b border-theme-border">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-theme-display text-xl text-theme-text">Customers</h1>
            <button
              onClick={() => { setShowAdd(true); setError(''); }}
              className="flex items-center gap-1.5 bg-theme-accent text-white px-3 py-1.5 rounded-theme text-xs font-theme-body font-medium hover:bg-theme-accent-hover transition-colors"
            >
              <UserPlus size={14} /> Add
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full bg-theme-surface-alt border border-theme-border rounded-theme pl-9 pr-3 py-2 text-sm font-theme-body text-theme-text focus:outline-none focus:border-theme-accent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-theme-text-muted font-theme-body">No customers found</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-theme-border/60 transition-colors ${
                selectedId === c.id ? 'bg-theme-accent-soft' : 'hover:bg-theme-surface-alt'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-theme-body font-medium text-sm text-theme-text">{c.name || 'Unnamed'}</span>
                <span className="text-[10px] text-theme-text-muted">{c.totalOrders} orders</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-0.5">
                <Phone size={10} /> {c.phone}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-auto p-8">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-theme-text-muted font-theme-body">
            Select a customer to view details
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-20 h-20 rounded-theme bg-theme-accent-soft flex items-center justify-center">
                <span className="font-theme-display text-3xl text-theme-accent">
                  {(selected.name || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="font-theme-display text-3xl text-theme-text">{selected.name || 'Unnamed'}</h2>
                <div className="flex flex-col gap-1 mt-1 text-sm font-theme-body text-theme-text-muted">
                  <span className="flex items-center gap-2"><Phone size={12} /> {selected.phone}</span>
                  {selected.email && <span className="flex items-center gap-2"><Mail size={12} /> {selected.email}</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <Stat label="Total Orders" value={String(selected.totalOrders)} />
              <Stat label="Total Spent" value={formatCurrency(Number(selected.totalSpent))} />
              <Stat label="Last Visit" value={selected.lastVisit ? formatDateTime(selected.lastVisit) : '—'} />
            </div>

            <p className="text-xs uppercase tracking-widest text-theme-text-muted font-theme-body">
              Member since {formatDateTime(selected.createdAt)}
            </p>
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-theme-surface w-[420px] rounded-theme shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border">
              <h3 className="font-theme-display text-xl text-theme-text">Add Customer</h3>
              <button onClick={() => setShowAdd(false)} className="text-theme-text-muted hover:text-theme-text">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <Field label="Name" value={newCust.name} onChange={(v) => setNewCust({ ...newCust, name: v })} />
              <Field label="Phone *" value={newCust.phone} onChange={(v) => setNewCust({ ...newCust, phone: v })} />
              <Field label="Email" value={newCust.email} onChange={(v) => setNewCust({ ...newCust, email: v })} />
              {error && <p className="text-xs text-theme-danger font-theme-body">{error}</p>}
              <button
                disabled={!newCust.phone || createMut.isPending}
                onClick={() => createMut.mutate({
                  name: newCust.name,
                  phone: newCust.phone,
                  email: newCust.email || undefined,
                })}
                className="w-full bg-theme-accent hover:bg-theme-accent-hover text-white py-2.5 rounded-theme font-theme-body font-medium text-sm transition-colors disabled:opacity-50"
              >
                {createMut.isPending ? 'Saving…' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-theme-surface border border-theme-border rounded-theme p-4">
      <p className="text-[10px] uppercase tracking-widest text-theme-text-muted font-theme-body">{label}</p>
      <p className="font-theme-display text-xl text-theme-text mt-1">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-widest text-theme-text-muted font-theme-body">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-theme-surface-alt border border-theme-border rounded-theme px-3 py-2 text-sm font-theme-body text-theme-text focus:outline-none focus:border-theme-accent"
      />
    </div>
  );
}
