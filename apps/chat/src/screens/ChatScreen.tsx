import { BadgeCheck, CalendarDays, ChevronDown, ChevronUp, MoreVertical, Phone, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { CHANNEL_LABEL, taka, type ChatMessage, type ConversationDetail } from '../lib/types';
import { Button, ErrorLine, Header } from '../ui';

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function Bubble({ m, onApprove, onDiscard }: { m: ChatMessage; onApprove: (text: string) => Promise<void>; onDiscard: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [busy, setBusy] = useState(false);
  const mine = m.sender !== 'CUSTOMER';
  const draft = m.status === 'DRAFT';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${
          draft ? 'bg-white border-2 border-dashed border-amber-brand' : mine ? (m.sender === 'STAFF' ? 'bg-beet text-white' : 'bg-beet-soft text-ink') : 'bg-white text-ink border border-ink-line'
        }`}
      >
        {draft && <div className="text-[11px] font-semibold text-amber-brand mb-1">Draft: not sent yet</div>}
        {editing ? (
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full min-w-[220px] rounded-lg border border-ink-line p-2 text-[15px] text-ink focus:outline-none" />
        ) : (
          <>
            {m.hasImage && <div className="text-xs opacity-70 mb-1">📷 photo</div>}
            {m.text}
          </>
        )}
        {m.cards && m.cards.length > 0 && (
          <div className="mt-2 space-y-1">
            {m.cards.map((c) => (
              <div key={c.url} className="flex items-center gap-2 rounded-lg bg-white/70 p-1.5 text-ink">
                {c.imageUrl && <img src={c.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />}
                <span className="text-xs flex-1">{c.name}</span>
                <span className="text-xs font-semibold">{taka(c.price)}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`text-[10px] mt-1 ${mine && m.sender === 'STAFF' && !draft ? 'text-white/70' : 'text-ink-soft'}`}>
          {time(m.createdAt)} · {m.sender === 'STAFF' ? m.staffName ?? 'Staff' : m.sender === 'BOT' ? (m.source === 'QUICK_REPLY' ? 'Bot (ready answer)' : 'Bot') : 'Customer'}
        </div>
        {draft && (
          <div className="flex gap-2 mt-2">
            <Button disabled={busy} onClick={() => void run(() => onApprove(text))} className="flex-1 !py-2">
              {editing ? 'Send edited' : 'Approve & send'}
            </Button>
            {!editing && (
              <Button kind="ghost" disabled={busy} onClick={() => setEditing(true)} className="!py-2">
                Edit
              </Button>
            )}
            <Button kind="danger" disabled={busy} onClick={() => void run(onDiscard)} className="!py-2">
              Discard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerPanel({ c }: { c: ConversationDetail }) {
  const [open, setOpen] = useState(false);
  const card = c.customer;
  return (
    <div className="bg-white border-b border-ink-line">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-2 text-sm">
        {c.customerPhone ? (
          <>
            <Phone size={14} className="text-beet" />
            <span className="font-semibold">{c.customerPhone}</span>
            {c.phoneVerifiedAt && <BadgeCheck size={15} className="text-[#1FA855]" aria-label="Verified" />}
          </>
        ) : (
          <span className="text-ink-soft">No phone number yet</span>
        )}
        {card && <span className="text-ink-soft">· {card.totalOrders > 0 ? `${card.totalOrders} visits` : 'new customer'}</span>}
        <span className="ml-auto text-ink-soft">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 text-sm space-y-1">
          {card ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Visits" value={String(card.totalOrders)} />
                <Stat label="Spent" value={taka(card.totalSpent)} />
                <Stat label="Last visit" value={card.lastVisit ? new Date(card.lastVisit).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
                <Stat label="Points" value={String(card.loyaltyPoints)} />
              </div>
              {card.upcoming.length > 0 && (
                <div className="pt-1">
                  <div className="text-xs font-semibold text-ink-soft mb-1">Upcoming bookings</div>
                  {card.upcoming.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm">
                      <CalendarDays size={14} className="text-beet" />
                      {new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} {r.timeSlot} · {r.partySize} guests · {r.status.toLowerCase()}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-ink-soft">Not linked to a customer yet. It links once the customer's phone number is known.</div>
          )}
          {c.leads.length > 0 && (
            <div className="pt-1 text-xs text-ink-soft">
              Party enquiry: {c.leads[0].guests} guests{c.leads[0].date ? `, ${c.leads[0].date}` : ''}{c.leads[0].occasion ? `, ${c.leads[0].occasion}` : ''} ({c.leads[0].status.toLowerCase()})
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cream px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

export default function ChatScreen({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [c, setC] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<ConversationDetail>(`/chatbot/conversations/${id}`).then(
      (r) => {
        setC(r);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  const shown = c?.messages.filter((m) => m.status === 'SENT' || m.status === 'DRAFT') ?? [];
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    await act(async () => {
      await api.post(`/chatbot/conversations/${id}/reply`, { text });
      setReply('');
    });
    setSending(false);
  };

  return (
    <div className="flex flex-col h-[100dvh]">
      <Header
        onBack="/"
        title={c?.customerName || c?.customerPhone || 'Customer'}
        subtitle={c ? `${CHANNEL_LABEL[c.channel]} · ${c.status === 'HUMAN' ? 'you are handling it, bot is quiet' : c.status === 'CLOSED' ? 'resolved' : 'bot is answering'}` : ''}
        right={
          <div className="relative">
            <button onClick={() => setMenu(!menu)} className="p-2 rounded-full active:bg-white/15" aria-label="Actions">
              <MoreVertical size={20} />
            </button>
            {menu && c && (
              <div className="absolute right-0 top-11 w-56 rounded-xl bg-white text-ink shadow-lg border border-ink-line overflow-hidden" onClick={() => setMenu(false)}>
                {c.status !== 'HUMAN' ? (
                  <MenuItem label="Take over (pause the bot)" onClick={() => void act(() => api.post(`/chatbot/conversations/${id}/take-over`))} />
                ) : (
                  <MenuItem label="Hand back to the bot" onClick={() => void act(() => api.post(`/chatbot/conversations/${id}/hand-back`))} />
                )}
                <MenuItem label="Mark resolved" onClick={() => void act(() => api.post(`/chatbot/conversations/${id}/resolve`))} />
              </div>
            )}
          </div>
        }
      />
      {c?.needsStaff && <div className="bg-beet-soft text-beet-dark text-sm px-4 py-2 font-medium">Needs you: {c.needsStaffReason ?? 'customer asked for a person'}</div>}
      {c && <CustomerPanel c={c} />}
      <ErrorLine error={error} />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-cream">
        {shown.map((m) => (
          <Bubble
            key={`${m.id}:${m.status}`}
            m={m}
            onApprove={(text) => act(() => api.post(`/chatbot/messages/${m.id}/send`, text.trim() !== m.text.trim() ? { text } : {}))}
            onDiscard={() => act(() => api.post(`/chatbot/messages/${m.id}/discard`))}
          />
        ))}
        <div ref={bottom} />
      </div>
      <div className="bg-white border-t border-ink-line px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-end gap-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={1}
          placeholder="Write a reply…"
          className="flex-1 resize-none rounded-2xl border border-ink-line px-3 py-2.5 text-[15px] max-h-32 focus:outline-none focus:border-beet"
        />
        <button onClick={() => void send()} disabled={sending || !reply.trim()} className="w-11 h-11 rounded-full bg-beet text-white flex items-center justify-center disabled:opacity-40" aria-label="Send">
          <Send size={18} />
        </button>
      </div>
      <p className="text-[10px] text-center text-ink-soft bg-white pb-1">Sending a reply pauses the bot on this chat.</p>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full text-left px-4 py-3 text-sm active:bg-cream border-b border-ink-line last:border-0">
      {label}
    </button>
  );
}
