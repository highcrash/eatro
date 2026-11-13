import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { CARD, ChannelBadge, ChatLead, fmtTime, HINT, INPUT, taka } from './shared';

const STATUSES: ChatLead['status'][] = ['NEW', 'CONTACTED', 'BOOKED', 'LOST'];
const STATUS_COLOR: Record<ChatLead['status'], string> = { NEW: '#FFA726', CONTACTED: '#4A90E2', BOOKED: '#4CAF50', LOST: '#666' };

export default function LeadsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data = [] } = useQuery<ChatLead[]>({ queryKey: ['chat-leads', status], queryFn: () => api.get(`/chatbot/leads${status ? `?status=${status}` : ''}`), refetchInterval: 30_000 });
  const update = useMutation({
    mutationFn: (v: { id: string; status?: string; notes?: string }) => api.patch(`/chatbot/leads/${v.id}`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-leads'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className={HINT}>Party and large-group enquiries from chat. Call the customer, then update the status.</p>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`ml-auto ${INPUT}`}>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </select>
      </div>
      <div className={`${CARD} divide-y divide-[#222]`}>
        {data.length === 0 && <p className={`${HINT} p-4`}>No enquiries yet.</p>}
        {data.map((l) => (
          <div key={l.id} className="p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              {l.conversation && <ChannelBadge channel={l.conversation.channel} />}
              <span className="text-white font-body text-sm">{l.name ?? l.conversation?.customerName ?? 'Customer'}</span>
              {(l.phone ?? l.conversation?.customerPhone) && <a href={`tel:${l.phone ?? l.conversation?.customerPhone}`} className="text-[#D62B2B] text-sm font-body">{l.phone ?? l.conversation?.customerPhone}</a>}
              <span className="text-[#ccc] text-sm font-body">{l.guests} guests{l.date ? ` · ${l.date}` : ''}{l.time ? ` ${l.time}` : ''}{l.occasion ? ` · ${l.occasion}` : ''}</span>
              <span className={`${HINT} ml-auto`}>{fmtTime(l.createdAt)}</span>
              <select value={l.status} onChange={(e) => update.mutate({ id: l.id, status: e.target.value })} className={INPUT} style={{ color: STATUS_COLOR[l.status] }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            {l.quote && l.quote.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {l.quote.map((o) => (
                  <button key={o.label} onClick={() => setOpen(open === `${l.id}:${o.label}` ? null : `${l.id}:${o.label}`)} className="text-xs font-body border border-[#2A2A2A] px-2 py-1 text-[#ccc] hover:border-[#555]">
                    {o.label}: {taka(o.perHead)}/head · {taka(o.total)}
                  </button>
                ))}
              </div>
            )}
            {l.quote?.filter((o) => open === `${l.id}:${o.label}`).map((o) => (
              <ul key={o.label} className="text-xs font-body text-[#aaa] pl-4 list-disc">
                {o.lines.map((ln) => <li key={ln.name}>{ln.qty}× {ln.name} · {taka(ln.lineTotal)}</li>)}
              </ul>
            ))}
            <input defaultValue={l.notes ?? ''} placeholder="Notes (called, deposit, menu agreed…)" onBlur={(e) => { if (e.target.value !== (l.notes ?? '')) update.mutate({ id: l.id, notes: e.target.value }); }} className={`w-full ${INPUT}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
