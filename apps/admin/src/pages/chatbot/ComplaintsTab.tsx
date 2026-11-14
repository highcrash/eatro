import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { CARD, chime, fmtTime, friendly, GHOST, HINT, INPUT, LABEL, PRIMARY, taka } from './shared';

type Level = 'SERIOUS' | 'ORDINARY' | 'MILD';
type Status = 'NEW' | 'CONTACTED' | 'RESOLVED';
interface Complaint {
  id: string;
  source: 'COMMENT' | 'CHAT';
  channel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  text: string;
  level: Level;
  topic: string;
  status: Status;
  draftReply: string | null;
  notes: string | null;
  outcome: string | null;
  openedAt: string | null;
  remindedAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  conversationId: string | null;
}
interface Detail extends Complaint {
  comment: { publicReply: string | null; privateReplySent: boolean; draftPublicReply: string | null; draftPrivateReply: string | null } | null;
  recentOrders: { id: string; orderNumber: string; createdAt: string; totalAmount: number; status: string; type: string; items: { menuItemName: string; quantity: number }[] }[];
}

const LEVEL_COLOR: Record<Level, string> = { SERIOUS: '#F03535', ORDINARY: '#FFA726', MILD: '#999' };
const OUTCOMES = ['Apologised', 'Replacement given', 'Voucher given', 'Refund given', 'No action needed'];

export default function ComplaintsTab() {
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<string | null>(null);
  const { data = [] } = useQuery<Complaint[]>({ queryKey: ['chat-complaints', status], queryFn: () => api.get(`/chatbot/complaints?status=${status}`), refetchInterval: 15_000 });

  // Chime for a new serious complaint, and again for each reminder.
  const alarm = data.filter((c) => c.level === 'SERIOUS' && !c.openedAt).map((c) => `${c.id}:${c.remindedAt ?? ''}`).join('|');
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current != null && alarm && alarm !== last.current) chime();
    last.current = alarm;
  }, [alarm]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      <div className="space-y-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`w-full ${INPUT}`}>
          <option value="open">Open</option>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="RESOLVED">Resolved</option>
          <option value="">All</option>
        </select>
        <div className={`${CARD} divide-y divide-[#222] max-h-[70vh] overflow-y-auto`}>
          {data.length === 0 && <p className={`${HINT} p-4`}>No complaints. They appear here from comments and chats.</p>}
          {data.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full text-left p-3 hover:bg-[#1C1C1C] ${selected === c.id ? 'bg-[#1F1F1F]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-body tracking-widest uppercase" style={{ color: LEVEL_COLOR[c.level] }}>{c.level.toLowerCase()}</span>
                <span className="text-[10px] font-body tracking-widest uppercase text-[#666]">{c.topic.toLowerCase()}</span>
                {!c.openedAt && <span className="text-[10px] font-body bg-[#D62B2B]/20 text-[#F03535] px-1.5">unopened</span>}
                <span className="text-[#555] text-[11px] font-body ml-auto">{fmtTime(c.createdAt)}</span>
              </div>
              <p className="text-white text-sm font-body mt-1">{c.customerName ?? 'Customer'} <span className={HINT}>· {c.source === 'COMMENT' ? `${(c.channel ?? '').toLowerCase()} comment` : `${(c.channel ?? '').toLowerCase()} chat`}</span></p>
              <p className="text-[#888] text-xs font-body line-clamp-2">{c.text}</p>
            </button>
          ))}
        </div>
      </div>
      {selected ? <ComplaintDetail key={selected} id={selected} /> : <div className={`${CARD} flex items-center justify-center min-h-[300px]`}><p className={HINT}>Choose a complaint.</p></div>}
    </div>
  );
}

function ComplaintDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: c } = useQuery<Detail>({ queryKey: ['chat-complaint', id], queryFn: () => api.get(`/chatbot/complaints/${id}`) });
  const [pub, setPub] = useState<string | null>(null);
  const [priv, setPriv] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [notes, setNotes] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['chat-complaint', id] }); void qc.invalidateQueries({ queryKey: ['chat-complaints'] }); };
  const update = useMutation({ mutationFn: (body: { status?: Status; notes?: string | null; outcome?: string | null }) => api.patch(`/chatbot/complaints/${id}`, body), onSuccess: refresh });
  const reply = useMutation({
    mutationFn: () => api.post(`/chatbot/complaints/${id}/reply`, c?.source === 'COMMENT' ? { publicReply: pub ?? c?.comment?.draftPublicReply ?? null, privateReply: priv ?? c?.comment?.draftPrivateReply ?? null } : { text: chatText }),
    onSuccess: () => { setChatText(''); refresh(); },
  });
  if (!c) return <div className={CARD} />;
  const publicDraft = pub ?? c.comment?.draftPublicReply ?? c.draftReply ?? '';
  const privateDraft = priv ?? c.comment?.draftPrivateReply ?? '';

  return (
    <div className={`${CARD} p-4 space-y-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-xl tracking-wide" style={{ color: LEVEL_COLOR[c.level] }}>{c.level} COMPLAINT</span>
        <span className={HINT}>{c.topic.toLowerCase()} · {fmtTime(c.createdAt)}{c.firstResponseAt ? ` · first response ${fmtTime(c.firstResponseAt)}` : ''}</span>
        <select value={c.status} onChange={(e) => update.mutate({ status: e.target.value as Status })} className={`ml-auto ${INPUT}`}>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>
      <div>
        <p className="text-white font-body text-sm">{c.customerName ?? 'Customer'}{c.customerPhone && <a href={`tel:${c.customerPhone}`} className="text-[#D62B2B] ml-2">{c.customerPhone}</a>}</p>
        <p className="text-white font-body text-base whitespace-pre-wrap mt-1 bg-[#0D0D0D] border border-[#2A2A2A] p-3">{c.text}</p>
        {c.comment?.publicReply && <p className="text-[#aaa] text-xs font-body mt-1">Page replied: {c.comment.publicReply}</p>}
      </div>

      <div className="space-y-2">
        <p className={LABEL}>Reply</p>
        {c.source === 'COMMENT' ? (
          <>
            <textarea value={publicDraft} onChange={(e) => setPub(e.target.value)} rows={2} placeholder="Short public reply under the comment" className={`w-full ${INPUT}`} />
            {!c.comment?.privateReplySent && <textarea value={privateDraft} onChange={(e) => setPriv(e.target.value)} rows={3} placeholder="Private message to the person" className={`w-full ${INPUT}`} />}
            <p className={HINT}>Good practice: acknowledge in one public line, then sort it out privately. Don't promise refunds in public.</p>
          </>
        ) : (
          <textarea value={chatText} onChange={(e) => setChatText(e.target.value)} rows={3} placeholder="Reply in the chat" className={`w-full ${INPUT}`} />
        )}
        {reply.error && <p className="text-[#F03535] text-xs font-body">{friendly(reply.error)}</p>}
        <button onClick={() => reply.mutate()} disabled={reply.isPending || (c.source === 'CHAT' ? !chatText.trim() : !publicDraft.trim() && !privateDraft.trim())} className={PRIMARY}>Send reply</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Outcome</label>
          <select value={c.outcome ?? ''} onChange={(e) => update.mutate({ outcome: e.target.value || null })} className={`w-full ${INPUT}`}>
            <option value="">Not recorded</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Notes</label>
          <textarea value={notes ?? c.notes ?? ''} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes != null && notes !== (c.notes ?? '')) update.mutate({ notes }); }} rows={2} className={`w-full ${INPUT}`} placeholder="Called at 3pm, offered…" />
        </div>
      </div>
      <p className={HINT}>Vouchers and refunds are given from Discounts and Orders as usual; record the outcome here.</p>

      <div>
        <p className={LABEL}>Recent orders{c.customerPhone ? ` for ${c.customerPhone}` : ''}</p>
        {!c.customerPhone && <p className={HINT}>No phone number yet. Ask for it in the private message to see their orders.</p>}
        {c.customerPhone && c.recentOrders.length === 0 && <p className={HINT}>No orders found for this number.</p>}
        <div className="space-y-1">
          {c.recentOrders.map((o) => (
            <p key={o.id} className="text-sm font-body text-[#ccc]">
              <span className="text-white">#{o.orderNumber}</span> · {fmtTime(o.createdAt)} · {taka(o.totalAmount / 100)} · {o.status.toLowerCase()}
              <span className={HINT}> · {o.items.map((i) => `${i.quantity}× ${i.menuItemName}`).join(', ')}</span>
            </p>
          ))}
        </div>
      </div>
      {c.conversationId && <button onClick={() => window.dispatchEvent(new CustomEvent('chatbot:open-conversation', { detail: c.conversationId }))} className={GHOST}>Open the chat</button>}
    </div>
  );
}
