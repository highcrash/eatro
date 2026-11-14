import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Hand, Image as ImageIcon, Search, Send, User } from 'lucide-react';

import { api } from '../../lib/api';
import { Cards, ChannelBadge, chime, ConversationDetail, ConversationSummary, fmtTime, friendly, GHOST, HINT, INPUT, PRIMARY, taka } from './shared';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'staff', label: 'Needs staff' },
  { key: 'drafts', label: 'Drafts to approve' },
  { key: 'human', label: 'Staff handling' },
] as const;

const who = (c: { customerName: string | null; customerPhone: string | null; channel: string }) =>
  c.customerName || c.customerPhone || (c.channel === 'WEB' ? 'Website visitor' : 'Customer');

export default function InboxTab({ initialId = null }: { initialId?: string | null }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(initialId);

  const { data: list = [] } = useQuery<ConversationSummary[]>({
    queryKey: ['chat-conversations', filter, search],
    queryFn: () => api.get(`/chatbot/conversations?filter=${filter}&search=${encodeURIComponent(search)}`),
    refetchInterval: 8_000,
  });

  // Chime when the number of chats waiting for staff goes up.
  const waiting = list.filter((c) => c.needsStaff).length;
  const lastWaiting = useRef<number | null>(null);
  useEffect(() => {
    if (lastWaiting.current != null && waiting > lastWaiting.current) chime();
    lastWaiting.current = waiting;
  }, [waiting]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 min-h-[600px]">
      <div className="bg-[#161616] border border-[#2A2A2A] flex flex-col">
        <div className="p-3 space-y-2 border-b border-[#2A2A2A]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or words" className={`w-full pl-8 ${INPUT}`} />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`text-[11px] font-body px-2 py-1 border ${filter === f.key ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-[#2A2A2A] text-[#888] hover:text-white'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[70vh]">
          {list.length === 0 && <p className={`${HINT} p-4`}>No chats yet. Website chats appear here as soon as customers write.</p>}
          {list.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)}
              className={`w-full text-left px-3 py-3 border-b border-[#1F1F1F] hover:bg-[#1C1C1C] ${selected === c.id ? 'bg-[#1F1F1F]' : ''}`}>
              <div className="flex items-center gap-2">
                <ChannelBadge channel={c.channel} />
                <span className="text-white text-sm font-body truncate flex-1">{who(c)}</span>
                <span className="text-[#555] text-[11px] font-body">{fmtTime(c.lastMessageAt)}</span>
              </div>
              <p className="text-[#888] text-xs font-body truncate mt-1">{c.lastMessage?.text ?? ''}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {c.needsStaff && <span className="text-[10px] font-body bg-[#D62B2B]/20 text-[#F03535] px-1.5 py-0.5">{c.needsStaffReason ?? 'Needs staff'}</span>}
                {c.drafts > 0 && <span className="text-[10px] font-body bg-[#FFA726]/15 text-[#FFA726] px-1.5 py-0.5">{c.drafts} draft{c.drafts > 1 ? 's' : ''}</span>}
                {c.status === 'HUMAN' && <span className="text-[10px] font-body bg-[#4CAF50]/15 text-[#4CAF50] px-1.5 py-0.5">Staff handling</span>}
                {c.staffUnread > 0 && <span className="text-[10px] font-body bg-white/10 text-white px-1.5 py-0.5">{c.staffUnread} new</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
      {selected ? <Thread key={selected} id={selected} onChange={() => void qc.invalidateQueries({ queryKey: ['chat-conversations'] })} /> : (
        <div className="bg-[#161616] border border-[#2A2A2A] flex items-center justify-center"><p className={HINT}>Choose a chat on the left.</p></div>
      )}
    </div>
  );
}

function Thread({ id, onChange }: { id: string; onChange: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: conv } = useQuery<ConversationDetail>({ queryKey: ['chat-conversation', id], queryFn: () => api.get(`/chatbot/conversations/${id}`), refetchInterval: 6_000 });
  const count = conv?.messages.length ?? 0;
  // Braces matter: newer browsers return a promise from scrollIntoView, and React would call it as a clean-up.
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [count]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-conversation', id] });
    onChange();
  };
  const act = useMutation({ mutationFn: (path: string) => api.post(`/chatbot/conversations/${id}/${path}`, {}), onSuccess: refresh });
  const send = useMutation({ mutationFn: () => api.post(`/chatbot/conversations/${id}/reply`, { text: reply }), onSuccess: () => { setReply(''); refresh(); } });
  const approve = useMutation({ mutationFn: (m: { id: string; text?: string }) => api.post(`/chatbot/messages/${m.id}/send`, { text: m.text }), onSuccess: () => { setEditing(null); refresh(); } });
  const discard = useMutation({ mutationFn: (mid: string) => api.post(`/chatbot/messages/${mid}/discard`, {}), onSuccess: refresh });

  if (!conv) return <div className="bg-[#161616] border border-[#2A2A2A]" />;
  const error = send.error ?? approve.error ?? act.error;
  const shown = conv.messages.filter((m) => m.status !== 'DISCARDED');

  return (
    <div className="bg-[#161616] border border-[#2A2A2A] flex flex-col">
      <div className="p-4 border-b border-[#2A2A2A] flex flex-wrap items-center gap-3">
        <ChannelBadge channel={conv.channel} />
        <div className="flex-1 min-w-0">
          <p className="text-white font-body text-sm">{who(conv)}</p>
          <p className={HINT}>{[conv.customerPhone, conv.status === 'HUMAN' ? 'Staff handling, bot is quiet' : 'Bot answering'].filter(Boolean).join(' · ')}</p>
        </div>
        {conv.needsStaff && <button onClick={() => act.mutate('resolve')} className={GHOST}>Mark done</button>}
        {conv.status === 'HUMAN'
          ? <button onClick={() => act.mutate('hand-back')} className={GHOST}><Bot size={14} className="inline mr-1" />Hand back to bot</button>
          : <button onClick={() => act.mutate('take-over')} className={GHOST}><Hand size={14} className="inline mr-1" />Take over</button>}
      </div>
      {conv.needsStaff && (
        <div className="px-4 py-2 bg-[#D62B2B]/10 border-b border-[#D62B2B]/30 text-[#F03535] text-xs font-body">{conv.needsStaffReason ?? 'This chat needs a team member.'}</div>
      )}
      {conv.leads.map((l) => (
        <div key={l.id} className="px-4 py-2 bg-[#FFA726]/10 border-b border-[#FFA726]/20 text-[#FFA726] text-xs font-body">
          Party enquiry: {l.guests} guests{l.date ? `, ${l.date}` : ''}{l.time ? ` ${l.time}` : ''}{l.occasion ? `, ${l.occasion}` : ''}
          {l.quote && l.quote.length > 0 && ` · ${l.quote.map((o) => `${o.label} ${taka(o.perHead)}/head`).join(', ')}`}
          {l.reservationId && ' · booking request created'}
        </div>
      ))}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[55vh]">
        {shown.map((m) => {
          const mine = m.sender !== 'CUSTOMER';
          const tone = m.status === 'SHADOW' ? 'border-dashed border-[#666] bg-transparent' : m.status === 'DRAFT' ? 'border-[#FFA726]/60 bg-[#FFA726]/5' : m.sender === 'STAFF' ? 'border-[#4CAF50]/40 bg-[#4CAF50]/5' : mine ? 'border-[#2A2A2A] bg-[#1F1F1F]' : 'border-[#2A2A2A] bg-[#0D0D0D]';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] border px-3 py-2 ${tone}`}>
                <p className="text-[10px] font-body tracking-widest uppercase text-[#666] mb-1 flex items-center gap-1">
                  {m.sender === 'CUSTOMER' ? <User size={10} /> : m.sender === 'STAFF' ? <Hand size={10} /> : <Bot size={10} />}
                  {m.sender === 'CUSTOMER' ? 'Customer' : m.sender === 'STAFF' ? (m.staffName ?? 'Staff') : m.status === 'SHADOW' ? `Trial model ${m.aiConnectionName ?? ''} (not sent)` : m.status === 'DRAFT' ? 'Suggested reply (not sent)' : `Bot · ${(m.source ?? '').replace('_', ' ').toLowerCase()}`}
                  <span className="ml-2 normal-case tracking-normal">{fmtTime(m.createdAt)}</span>
                </p>
                {m.hasImage && <p className="text-[#888] text-xs font-body flex items-center gap-1"><ImageIcon size={12} /> sent a photo</p>}
                {editing?.id === m.id ? (
                  <textarea value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} rows={4} className={`w-full ${INPUT}`} />
                ) : (
                  <p className="text-white text-sm font-body whitespace-pre-wrap">{m.text}</p>
                )}
                <Cards cards={m.cards} />
                {m.status === 'DRAFT' && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => approve.mutate({ id: m.id, text: editing?.id === m.id ? editing.text : undefined })} className={`${PRIMARY} !px-3 !py-1 text-xs`}>Send</button>
                    {editing?.id !== m.id && <button onClick={() => setEditing({ id: m.id, text: m.text })} className={`${GHOST} !px-3 !py-1 text-xs`}>Edit</button>}
                    <button onClick={() => discard.mutate(m.id)} className={`${GHOST} !px-3 !py-1 text-xs`}>Discard</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="p-3 border-t border-[#2A2A2A] space-y-2">
        {error && <p className="text-[#F03535] text-xs font-body">{friendly(error)}</p>}
        <div className="flex gap-2">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply as staff. The bot stays quiet on this chat for a while after you reply."
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && reply.trim()) { e.preventDefault(); send.mutate(); } }}
            className={`flex-1 ${INPUT}`} />
          <button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending} className={PRIMARY}><Send size={14} /></button>
        </div>
      </div>
    </div>
  );
}
