import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Copy, KeyRound, Plus, Power, X } from 'lucide-react';

import { api } from '../lib/api';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdBy: { id: string; name: string; email: string };
}

interface CreatedKey {
  id: string;
  prefix: string;
  plaintextKey: string;
}

const ALL_SCOPES = [
  { value: 'business:read', label: 'Business profile', hint: 'Identity, contact, branding, social, tax' },
  { value: 'reports:read', label: 'Sales reports', hint: 'Sales, top items, daily series, performance' },
  { value: 'finance:read', label: 'Finance', hint: 'Recorded expenses' },
  { value: 'inventory:read', label: 'Inventory', hint: 'Stock levels and cost per unit' },
  { value: 'menu:read', label: 'Menu', hint: 'Menu items, categories, prices' },
  { value: 'customers:read', label: 'Customers', hint: 'Customer aggregates + segments (PII)' },
  { value: 'loyalty:read', label: 'Loyalty', hint: 'Loyalty balances and settings' },
  { value: 'marketing:read', label: 'Marketing campaigns', hint: 'Read campaign list' },
  { value: 'marketing:write', label: 'Create campaigns', hint: 'Mint coupons + send SMS (write)' },
  { value: 'reviews:read', label: 'Reviews', hint: 'Aggregate review scores' },
] as const;

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['external-api-keys'],
    queryFn: () => api.get('/admin/api-keys'),
  });

  const [showForm, setShowForm] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftScopes, setDraftScopes] = useState<string[]>([]);
  const [draftExpiry, setDraftExpiry] = useState('');
  const [revealed, setRevealed] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = useMutation({
    mutationFn: (body: { name: string; scopes: string[]; expiresAt?: string }) =>
      api.post<CreatedKey>('/admin/api-keys', body),
    onSuccess: (data) => {
      setRevealed(data);
      setShowForm(false);
      setDraftName('');
      setDraftScopes([]);
      setDraftExpiry('');
      qc.invalidateQueries({ queryKey: ['external-api-keys'] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['external-api-keys'] }),
  });

  const toggleScope = (scope: string) => {
    setDraftScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const submitCreate = () => {
    if (!draftName.trim() || draftScopes.length === 0) return;
    createMut.mutate({
      name: draftName.trim(),
      scopes: draftScopes,
      expiresAt: draftExpiry ? new Date(draftExpiry).toISOString() : undefined,
    });
  };

  const copyKey = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.plaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A]">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Owner only</p>
        <h1 className="font-display text-white text-4xl tracking-wide flex items-center gap-3">
          <KeyRound size={28} /> INTEGRATIONS
        </h1>
        <p className="text-[#888] text-sm font-body mt-2 max-w-3xl">
          API keys for external systems that need read access to this branch's business data — e.g.
          the AI Marketing Agent. Keys are bound to this branch and scope-gated. The secret is
          shown <span className="text-white">once</span> at creation; store it immediately.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-6">
        {revealed && <PlaintextKeyBanner revealed={revealed} copied={copied} onCopy={copyKey} onDismiss={() => setRevealed(null)} />}

        <div className="max-w-5xl flex items-center justify-between">
          <p className="text-[#888] text-xs font-body uppercase tracking-widest">
            {keys.length} key{keys.length === 1 ? '' : 's'}
          </p>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-[#D62B2B] hover:bg-[#B82424] text-white px-4 py-2 text-xs font-body font-medium tracking-widest uppercase"
            >
              <Plus size={14} /> New API key
            </button>
          )}
        </div>

        {showForm && (
          <div className="bg-[#161616] border border-[#2A2A2A] p-6 max-w-5xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-white text-2xl tracking-wide">CREATE API KEY</h2>
              <button onClick={() => setShowForm(false)} className="text-[#888] hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-[#888] mb-2">
                  Name
                </label>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Marketing AI — Production"
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-[#888] mb-2">
                  Scopes — what this key can read or do
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SCOPES.map((s) => (
                    <label
                      key={s.value}
                      className={`flex items-start gap-2 border px-3 py-2 cursor-pointer text-sm font-body ${
                        draftScopes.includes(s.value)
                          ? 'border-[#D62B2B] bg-[#D62B2B]/5 text-white'
                          : 'border-[#2A2A2A] text-[#CCC] hover:border-[#444]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={draftScopes.includes(s.value)}
                        onChange={() => toggleScope(s.value)}
                        className="mt-0.5 accent-[#D62B2B]"
                      />
                      <div>
                        <div className="text-sm leading-tight">{s.label}</div>
                        <div className="text-[11px] text-[#888]">{s.hint}</div>
                        <code className="text-[10px] text-[#666]">{s.value}</code>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-body font-medium tracking-widest uppercase text-[#888] mb-2">
                  Expiry (optional)
                </label>
                <input
                  type="date"
                  value={draftExpiry}
                  onChange={(e) => setDraftExpiry(e.target.value)}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>

              {createMut.isError && (
                <p className="text-[#D62B2B] text-xs font-body">
                  {(createMut.error as Error).message}
                </p>
              )}

              <div className="flex items-center gap-3 pt-2 border-t border-[#2A2A2A]">
                <button
                  onClick={submitCreate}
                  disabled={!draftName.trim() || draftScopes.length === 0 || createMut.isPending}
                  className="bg-[#D62B2B] hover:bg-[#B82424] disabled:bg-[#2A2A2A] disabled:text-[#666] text-white px-4 py-2 text-xs font-body font-medium tracking-widest uppercase"
                >
                  {createMut.isPending ? 'Creating…' : 'Generate key'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-[#888] hover:text-white px-4 py-2 text-xs font-body tracking-widest uppercase"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#161616] border border-[#2A2A2A] max-w-5xl">
          {isLoading ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">
              No API keys yet. Click <span className="text-white">New API key</span> above to mint one.
            </p>
          ) : (
            <table className="w-full text-sm font-body">
              <thead className="bg-[#1A1A1A] text-[#666] text-[10px] tracking-widest uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Prefix</th>
                  <th className="px-4 py-3 text-left">Scopes</th>
                  <th className="px-4 py-3 text-left">Last used</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const status = k.revokedAt
                    ? 'revoked'
                    : k.expiresAt && new Date(k.expiresAt) < new Date()
                    ? 'expired'
                    : 'active';
                  return (
                    <tr key={k.id} className="border-t border-[#2A2A2A] hover:bg-[#1A1A1A] align-top">
                      <td className="px-6 py-3 text-white">
                        <div>{k.name}</div>
                        <div className="text-[11px] text-[#666] mt-0.5">
                          Created {new Date(k.createdAt).toLocaleDateString()} · by {k.createdBy.email}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-[#CCC] text-[11px]">rk_{k.prefix}_…</code>
                      </td>
                      <td className="px-4 py-3 text-[#CCC]">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {k.scopes.map((s) => (
                            <span
                              key={s}
                              className="text-[10px] tracking-wider uppercase px-1.5 py-0.5 bg-[#2A2A2A] text-[#AAA]"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#CCC]">{formatRelative(k.lastUsedAt)}</td>
                      <td className="px-4 py-3">
                        {status === 'active' ? (
                          <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#4CAF50]/20 text-[#4CAF50]">
                            Active
                          </span>
                        ) : status === 'expired' ? (
                          <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#2A2A2A] text-[#888]">
                            Expired
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#2A2A2A] text-[#888]">
                            Revoked
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {status === 'active' && (
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  `Revoke "${k.name}"? This is permanent — any system using this key will start getting 401 immediately.`,
                                )
                              ) {
                                revokeMut.mutate(k.id);
                              }
                            }}
                            title="Revoke"
                            className="inline-flex items-center gap-1 text-[#D62B2B] hover:bg-[#D62B2B]/10 px-2 py-1 text-[10px] font-medium tracking-widest uppercase"
                          >
                            <Power size={12} /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="max-w-5xl text-[#666] text-xs font-body leading-relaxed">
          Looking for the contract? See <code className="text-[#AAA]">/api/docs/external</code> for
          the OpenAPI spec and <code className="text-[#AAA]">docs/external-api/README.md</code> for
          quickstart.
        </div>
      </div>
    </div>
  );
}

function PlaintextKeyBanner({
  revealed,
  copied,
  onCopy,
  onDismiss,
}: {
  revealed: CreatedKey;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="max-w-5xl bg-[#D62B2B]/10 border border-[#D62B2B] p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-[#D62B2B] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-display text-white text-xl tracking-wide">SAVE THIS NOW</h3>
          <p className="text-[#CCC] text-xs font-body mt-1 mb-3">
            This is the only time the full key is shown. After you close this banner it cannot be
            recovered — only the prefix remains.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-mono break-all">
              {revealed.plaintextKey}
            </code>
            <button
              onClick={onCopy}
              className="inline-flex items-center gap-1 bg-[#D62B2B] hover:bg-[#B82424] text-white px-3 py-2 text-xs font-body font-medium tracking-widest uppercase"
            >
              <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <button onClick={onDismiss} className="text-[#888] hover:text-white">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
