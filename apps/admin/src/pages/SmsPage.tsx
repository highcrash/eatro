import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, RefreshCw, Trash2, Plus, Send } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Admin → SMS. Three things live here:
 *   1. Balance card — quick read of how many credits are left on the
 *      api.sms.net.bd account the branch is configured against.
 *   2. Templates CRUD — reusable bodies for campaigns. {{name}} falls
 *      back to "Dear Customer" at render time; {{phone}} is also
 *      available.
 *   3. Log table — every SMS the app has sent (payment receipts, OTPs,
 *      campaigns, etc.) with a per-row refresh-status + retry button.
 *
 * Campaigns themselves are composed from Customers page (multi-select
 * → Send SMS), not here; this page just logs + audits them.
 */

interface Template { id: string; name: string; body: string }
interface LogRow {
  id: string;
  toPhone: string;
  body: string;
  kind: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'EXPIRED';
  requestId: string | null;
  errorText: string | null;
  attempts: number;
  campaignId: string | null;
  createdAt: string;
}

const STATUS_CLASSES: Record<LogRow['status'], string> = {
  QUEUED: 'text-[#FFA726]',
  SENT: 'text-[#4CAF50]',
  DELIVERED: 'text-[#C8FF00]',
  FAILED: 'text-[#F03535]',
  EXPIRED: 'text-[#888]',
};

export default function SmsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'logs' | 'templates'>('logs');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  const { data: balance } = useQuery<{ balance: number | null }>({
    queryKey: ['sms', 'balance'],
    queryFn: () => api.get('/settings/sms/balance'),
    staleTime: 60_000,
  });

  const { data: logs = [], refetch: refetchLogs } = useQuery<LogRow[]>({
    queryKey: ['sms', 'logs', statusFilter, kindFilter],
    queryFn: () => api.get(`/sms/logs?${new URLSearchParams({
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
    }).toString()}`),
    refetchInterval: 15_000,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['sms', 'templates'],
    queryFn: () => api.get('/sms/templates'),
  });

  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/sms/logs/${id}/refresh`, {}),
    onSuccess: () => { void refetchLogs(); },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/sms/logs/${id}/retry`, {}),
    onSuccess: () => { void refetchLogs(); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MessageSquare className="w-6 h-6 text-[#D62B2B]" />
        <h1 className="font-display text-3xl text-white tracking-widest">SMS</h1>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[#666] text-xs font-body tracking-widest uppercase">Balance</span>
          <span className="text-white font-display text-lg">{balance?.balance != null ? `${balance.balance.toFixed(2)}` : '—'}</span>
          <button
            onClick={() => { void qc.invalidateQueries({ queryKey: ['sms', 'balance'] }); }}
            className="text-[#666] hover:text-white transition-colors"
            title="Refresh balance"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#2A2A2A]">
        {(['logs', 'templates'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 font-body text-xs tracking-widest uppercase border-b-2 -mb-px ${
              tab === t ? 'border-[#D62B2B] text-white' : 'border-transparent text-[#666] hover:text-[#999]'
            }`}
          >
            {t === 'logs' ? 'Sent Log' : 'Templates'}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body">
              <option value="">All statuses</option>
              {['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'EXPIRED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-xs font-body">
              <option value="">All kinds</option>
              {['CAMPAIGN', 'PAYMENT', 'RESERVATION', 'OTP', 'OTHER'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <div className="flex items-center text-[#666] text-xs font-body ml-auto">{logs.length} rows</div>
          </div>

          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-[#2A2A2A] text-left text-xs text-[#999] tracking-widest uppercase">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Body</th>
                  <th className="px-4 py-3 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                    <td className="px-4 py-3 text-[#999] text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-white font-mono text-xs">{log.toPhone}</td>
                    <td className="px-4 py-3 text-[#999] text-xs">{log.kind}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs tracking-widest uppercase ${STATUS_CLASSES[log.status]}`}>{log.status}</span>
                      {log.errorText && <span className="block text-[#F03535] text-[10px] mt-0.5" title={log.errorText}>{log.errorText.slice(0, 40)}</span>}
                    </td>
                    <td className="px-4 py-3 text-[#ccc] text-xs max-w-xl truncate" title={log.body}>{log.body}</td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => refresh.mutate(log.id)} className="text-[#666] hover:text-white text-xs tracking-widest uppercase" title="Refresh status">
                        <RefreshCw size={12} />
                      </button>
                      {(log.status === 'FAILED' || log.status === 'EXPIRED') && (
                        <button onClick={() => retry.mutate(log.id)} className="text-[#FFA726] hover:text-white text-xs tracking-widest uppercase">
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#666] text-sm">No SMS sent yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'templates' && <TemplatesTab templates={templates} />}
    </div>
  );
}

function TemplatesTab({ templates }: { templates: Template[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', body: '' });

  const saveMut = useMutation({
    mutationFn: (t: { id?: string; name: string; body: string }) =>
      t.id ? api.patch(`/sms/templates/${t.id}`, { name: t.name, body: t.body })
           : api.post('/sms/templates', { name: t.name, body: t.body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sms', 'templates'] });
      setEditing(null); setCreating(false); setForm({ name: '', body: '' });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sms/templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sms', 'templates'] }),
  });

  const openEdit = (t: Template) => { setEditing(t); setCreating(false); setForm({ name: t.name, body: t.body }); };
  const openNew = () => { setCreating(true); setEditing(null); setForm({ name: '', body: '' }); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[#666] font-body text-xs">Placeholders: <code>{'{{name}}'}</code> (falls back to "Dear Customer"), <code>{'{{phone}}'}</code></p>
        <button onClick={openNew} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-xs tracking-widest uppercase px-4 py-2 flex items-center gap-1">
          <Plus size={12} /> New Template
        </button>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-[#2A2A2A] text-left text-xs text-[#999] tracking-widest uppercase">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Body</th>
              <th className="px-4 py-3 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-4 py-3 text-white">{t.name}</td>
                <td className="px-4 py-3 text-[#ccc] text-xs max-w-2xl truncate" title={t.body}>{t.body}</td>
                <td className="px-4 py-3 flex gap-2">
                  <button onClick={() => openEdit(t)} className="text-[#999] hover:text-white text-xs tracking-widest uppercase">Edit</button>
                  <button
                    onClick={() => { if (confirm(`Delete template "${t.name}"?`)) deleteMut.mutate(t.id); }}
                    className="text-[#D62B2B] hover:text-[#F03535] text-xs tracking-widest uppercase"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-[#666] text-sm">No templates yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => { setEditing(null); setCreating(false); }}>
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-white tracking-widest">{editing ? 'EDIT TEMPLATE' : 'NEW TEMPLATE'}</h3>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs tracking-widest uppercase">Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs tracking-widest uppercase">Body</label>
              <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                rows={6}
                placeholder="Hi {{name}}, check out our new menu!"
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-mono" />
              <span className="text-[#666] text-[10px]">{form.body.length} chars</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setEditing(null); setCreating(false); }} className="flex-1 bg-[#2A2A2A] text-white py-2.5 text-sm">Cancel</button>
              <button
                onClick={() => saveMut.mutate({ id: editing?.id, name: form.name, body: form.body })}
                disabled={!form.name.trim() || !form.body.trim() || saveMut.isPending}
                className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send size={12} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
