import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, X, Building2, Copy, Check } from 'lucide-react';

import type { Branch, CreateBranchDto, UpdateBranchDto } from '@restora/types';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

interface BranchForm {
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  timezone: string;
  taxRate: string;
}

const EMPTY_FORM: BranchForm = {
  name: '',
  address: '',
  phone: '',
  email: '',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  taxRate: '0',
};

export default function BranchesPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [archiving, setArchiving] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [error, setError] = useState('');

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches'),
  });

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        address: editing.address,
        phone: editing.phone,
        email: editing.email ?? '',
        currency: editing.currency,
        timezone: editing.timezone,
        taxRate: String(editing.taxRate),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError('');
  }, [editing]);

  const createMut = useMutation({
    mutationFn: (dto: CreateBranchDto) => api.post<Branch>('/branches', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branches'] });
      setShowAdd(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (dto: UpdateBranchDto) => api.patch<Branch>(`/branches/${editing!.id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branches'] });
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.delete(`/branches/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branches'] });
      setArchiving(null);
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!form.name.trim() || !form.address.trim() || !form.phone.trim()) {
      setError('Name, address, and phone are required');
      return;
    }
    const dto: CreateBranchDto = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      currency: form.currency,
      timezone: form.timezone,
      taxRate: parseFloat(form.taxRate || '0'),
    };
    if (editing) updateMut.mutate(dto);
    else createMut.mutate(dto);
  };

  const isOwner = currentUser?.role === 'OWNER';
  const showForm = showAdd || !!editing;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyBranchId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard API can fail in insecure contexts — fall back to prompt.
      window.prompt('Copy Branch ID:', id);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Settings</p>
          <h1 className="font-display text-white text-4xl tracking-wide">BRANCHES</h1>
        </div>
        {isOwner && (
          <button
            onClick={() => { setShowAdd(true); setEditing(null); }}
            className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase"
          >
            <Plus size={14} /> Add Branch
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-8">
        {!isOwner && (
          <div className="bg-[#161616] border border-[#2A2A2A] p-4 mb-4 text-xs font-body text-[#999]">
            Only OWNER role can create or edit branches. You're logged in as {currentUser?.role}.
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {branches.map((b) => (
            <div key={b.id} className="bg-[#161616] border border-[#2A2A2A] p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Building2 size={18} className="text-[#D62B2B]" />
                  <h3 className="font-display text-white text-xl tracking-wide">{b.name}</h3>
                </div>
                {b.isActive ? (
                  <span className="text-[9px] font-body font-bold tracking-widest uppercase bg-[#4CAF50]/15 text-[#4CAF50] px-2 py-0.5">
                    ACTIVE
                  </span>
                ) : (
                  <span className="text-[9px] font-body font-bold tracking-widest uppercase bg-[#666]/15 text-[#666] px-2 py-0.5">
                    INACTIVE
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void copyBranchId(b.id)}
                title="Copy Branch ID — paste into the desktop POS First-Run Setup"
                className="w-full mb-3 flex items-center gap-2 bg-[#0D0D0D] border border-[#2A2A2A] hover:border-[#D62B2B] px-2 py-1.5 text-left transition-colors group"
              >
                <span className="text-[9px] font-body font-medium tracking-widest uppercase text-[#666] group-hover:text-[#D62B2B]">ID</span>
                <span className="text-[11px] font-mono text-[#CCC] truncate flex-1">{b.id}</span>
                {copiedId === b.id ? (
                  <Check size={12} className="text-[#4CAF50] flex-shrink-0" />
                ) : (
                  <Copy size={12} className="text-[#666] group-hover:text-[#D62B2B] flex-shrink-0" />
                )}
              </button>

              <div className="space-y-1 text-xs font-body text-[#DDD9D3]">
                <p>{b.address}</p>
                <p>📞 {b.phone}</p>
                {b.email && <p>✉ {b.email}</p>}
                <p className="text-[#999] mt-2">
                  Currency: {b.currency} · Tax: {Number(b.taxRate)}% · {b.timezone}
                </p>
              </div>

              {isOwner && (
                <div className="flex gap-2 mt-4 pt-3 border-t border-[#2A2A2A]">
                  <button
                    onClick={() => setEditing(b)}
                    className="flex items-center gap-1 text-[10px] font-body font-medium tracking-widest uppercase text-[#999] hover:text-[#D62B2B] transition-colors"
                  >
                    <Edit size={12} /> Edit
                  </button>
                  <button
                    onClick={() => setArchiving(b)}
                    className="flex items-center gap-1 text-[10px] font-body font-medium tracking-widest uppercase text-[#999] hover:text-[#D62B2B] transition-colors ml-auto"
                  >
                    <Trash2 size={12} /> Archive
                  </button>
                </div>
              )}
            </div>
          ))}

          {branches.length === 0 && (
            <p className="col-span-3 text-center text-[#666] font-body text-sm py-12">
              No branches yet.
            </p>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setShowAdd(false); setEditing(null); }}
        >
          <div
            className="bg-[#0D0D0D] border border-[#2A2A2A] w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
              <h2 className="font-display text-white text-2xl tracking-wide">
                {editing ? 'EDIT BRANCH' : 'ADD BRANCH'}
              </h2>
              <button
                onClick={() => { setShowAdd(false); setEditing(null); }}
                className="text-[#999] hover:text-white"
              >
                <X size={18} />
              </button>
            </header>

            <div className="p-6 space-y-4">
              <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Address *" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              <Field label="Phone *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Currency" value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
                <Field label="Timezone" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} />
              </div>
              <Field label="Tax Rate (%)" value={form.taxRate} onChange={(v) => setForm({ ...form, taxRate: v })} type="number" />

              {error && <p className="text-xs text-[#D62B2B] font-body">{error}</p>}
            </div>

            <div className="px-6 py-4 border-t border-[#2A2A2A] flex gap-3">
              <button
                onClick={() => { setShowAdd(false); setEditing(null); }}
                className="flex-1 border border-[#2A2A2A] py-3 text-sm font-body text-[#999] hover:border-[#D62B2B] hover:text-[#D62B2B] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMut.isPending || updateMut.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white py-3 text-sm font-body font-medium transition-colors disabled:opacity-40"
              >
                {createMut.isPending || updateMut.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive confirm */}
      {archiving && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setArchiving(null)}
        >
          <div className="bg-[#0D0D0D] border border-[#2A2A2A] w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <header className="px-6 py-4 border-b border-[#2A2A2A]">
              <h3 className="font-display text-white text-xl tracking-wide">ARCHIVE BRANCH?</h3>
            </header>
            <div className="p-6 space-y-3">
              <p className="text-sm font-body text-[#DDD9D3]">
                <span className="text-white font-medium">{archiving.name}</span> will be hidden from all lists.
                Existing data is preserved and the branch can be restored from the database if needed.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-[#2A2A2A] flex gap-3">
              <button
                onClick={() => setArchiving(null)}
                className="flex-1 border border-[#2A2A2A] py-3 text-sm font-body text-[#999] hover:border-white hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => archiveMut.mutate(archiving.id)}
                disabled={archiveMut.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white py-3 text-sm font-body font-medium transition-colors disabled:opacity-40"
              >
                {archiveMut.isPending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-body font-medium tracking-widest uppercase text-[#999]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
      />
    </div>
  );
}
