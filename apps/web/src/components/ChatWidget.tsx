import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { getActiveBranchId } from '../lib/cms';

interface ChatConfig { enabled: boolean; assistantName: string; greeting: string; photos: boolean; retentionDays: number; verify: { coupon: number | null } | null }
interface Card { name: string; price: number; wasPrice: number | null; imageUrl: string | null; url: string }
interface Msg { id: string; sender: 'CUSTOMER' | 'BOT' | 'STAFF'; text: string; cards: Card[] | null; hasImage?: boolean; createdAt: string; pending?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
const SESSION_KEY = 'eatro-chat-session';
const VERIFY_HIDDEN_KEY = 'eatro-chat-verify-hidden';
const DAY_MS = 24 * 3600_000;

function verifyHidden(): boolean {
  try {
    const at = Number(localStorage.getItem(VERIFY_HIDDEN_KEY) ?? 0);
    return Date.now() - at < DAY_MS;
  } catch {
    return false;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new Error(res.status === 429 ? 'Please wait a minute and try again.' : (msg ?? 'Something went wrong').replace(/^[A-Z_]+:\s*/, ''));
  }
  return data;
}
const CHIPS = [
  { label: 'Opening hours', text: 'What are your opening hours?' },
  { label: "Today's offers", text: 'What offers do you have today?' },
  { label: 'Book a table', text: "I'd like to book a table." },
  { label: 'Party quote', text: "We're planning a party. How much would it cost per person?" },
];

function sessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const fresh = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
    localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  }
}

const money = (n: number) => `৳${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo')); };
    img.src = url;
  });
}

export default function ChatWidget() {
  const branchId = getActiveBranchId();
  const { data: config } = useQuery<ChatConfig>({
    queryKey: ['chat-config', branchId],
    queryFn: () => api.getJson<ChatConfig>(`/public/chatbot/config?branchId=${encodeURIComponent(branchId)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffActive, setStaffActive] = useState(false);
  const [verified, setVerified] = useState(false);
  const [hideVerify, setHideVerify] = useState(verifyHidden);
  const session = useRef<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!session.current) session.current = sessionId();
    const res = await api.getJson<{ messages: Msg[]; staffActive: boolean; verified?: boolean }>(
      `/public/chatbot/messages?branchId=${encodeURIComponent(branchId)}&sessionId=${session.current}`,
    );
    setMessages(res.messages);
    setStaffActive(res.staffActive);
    setVerified(!!res.verified);
  }, [branchId]);

  useEffect(() => {
    if (!open) return;
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 6_000);
    return () => clearInterval(t);
  }, [open, load]);
  // Braces matter: newer browsers return a promise from scrollIntoView, and React would call it as a clean-up.
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length, busy, open]);

  const send = async (body: { text?: string; image?: string }, shown: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, sender: 'CUSTOMER', text: shown, cards: null, createdAt: new Date().toISOString(), pending: true }]);
    try {
      const res = await fetch(`${BASE}/public/chatbot/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, sessionId: session.current || (session.current = sessionId()), ...body }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(res.status === 429 ? 'You are sending messages quickly. Please wait a moment.' : (e.message ?? 'Message not sent').replace(/^[A-Z_]+:\s*/, ''));
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.filter((x) => !x.pending));
    } finally {
      setBusy(false);
    }
  };

  if (!config?.enabled) return null;

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label={`Chat with ${config.assistantName}`}
          className="fixed bottom-5 right-5 z-[60] w-14 h-14 rounded-full bg-btn text-white shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-9 6l2.5-3H19a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h.5" />
          </svg>
        </button>
      )}
      {open && (
        <div className="fixed z-[60] inset-x-0 bottom-0 sm:inset-x-auto sm:right-5 sm:bottom-5 w-full sm:w-[380px] h-[85vh] sm:h-[560px] bg-card text-text border border-border shadow-2xl flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-btn text-white">
            <div className="flex-1">
              <p className="font-display text-lg tracking-wider leading-none">{config.assistantName}</p>
              <p className="text-[11px] opacity-80">{staffActive ? 'A team member is replying' : 'Virtual assistant · a team member can join any time'}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="w-8 h-8 flex items-center justify-center hover:opacity-80">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-bg">
            <Bubble mine={false} text={config.greeting} />
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <button key={c.label} onClick={() => void send({ text: c.text }, c.text)} className="text-xs border border-accent text-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-colors">
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <Bubble key={m.id} mine={m.sender === 'CUSTOMER'} staff={m.sender === 'STAFF'} text={m.hasImage && m.text === '[photo]' ? '📷 Photo' : m.text} cards={m.cards} faded={m.pending} />
            ))}
            {busy && <p className="text-xs text-muted">{config.assistantName} is typing…</p>}
            {config.verify && !verified && !hideVerify && !busy && messages.some((m) => m.sender !== 'CUSTOMER') && (
              <VerifyCard
                branchId={branchId}
                sessionId={() => session.current || (session.current = sessionId())}
                coupon={config.verify.coupon}
                onDone={() => { setVerified(true); void load().catch(() => undefined); }}
                onHide={() => {
                  setHideVerify(true);
                  try { localStorage.setItem(VERIFY_HIDDEN_KEY, String(Date.now())); } catch { /* private window */ }
                }}
              />
            )}
            <div ref={bottom} />
          </div>

          {error && <p className="px-3 py-1 text-xs text-red-500">{error}</p>}
          <div className="p-2 border-t border-border flex gap-2 items-center">
            {config.photos && (
              <>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try { await send({ image: await shrink(f) }, '📷 Photo'); } catch (err) { setError((err as Error).message); }
                }} />
                <button onClick={() => fileRef.current?.click()} aria-label="Send a photo" className="w-9 h-9 flex items-center justify-center text-muted hover:text-text">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3" /></svg>
                </button>
              </>
            )}
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
              onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { const t = text; setText(''); void send({ text: t }, t); } }}
              placeholder="Type your message…" className="flex-1 bg-bg border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
            <button disabled={!text.trim() || busy} onClick={() => { const t = text; setText(''); void send({ text: t }, t); }}
              className="bg-btn text-white px-3 py-2 text-sm font-bold disabled:opacity-40">Send</button>
          </div>
          <p className="px-3 pb-2 text-[10px] text-muted">
            Replies may be written by AI and checked against our live menu. Chats are kept for {config.retentionDays} days. <Link to="/privacy" className="underline">Privacy</Link>
          </p>
        </div>
      )}
    </>
  );
}

function Bubble({ mine, staff, text, cards, faded }: { mine: boolean; staff?: boolean; text: string; cards?: Card[] | null; faded?: boolean }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${faded ? 'opacity-60' : ''}`}>
      <div className={`max-w-[85%] px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'bg-btn text-white' : 'bg-card border border-border'}`}>
        {staff && <p className="text-[10px] uppercase tracking-widest text-accent mb-0.5">Team member</p>}
        {text}
        {cards && cards.length > 0 && (
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
            {cards.map((c) => (
              <a key={c.url + c.name} href={c.url} className="shrink-0 w-36 bg-bg border border-border text-text hover:border-accent">
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-24 object-cover" /> : <div className="w-full h-24 bg-hover" />}
                <div className="p-2">
                  <p className="text-xs font-semibold leading-tight">{c.name}</p>
                  <p className="text-xs text-accent mt-0.5">{money(c.price)}{c.wasPrice != null && <span className="text-muted line-through ml-1">{money(c.wasPrice)}</span>}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Name and mobile, then the 6-digit code from the SMS. Shown once per chat until done or dismissed. */
function VerifyCard({ branchId, sessionId, coupon, onDone, onHide }: { branchId: string; sessionId: () => string; coupon: number | null; onDone: () => void; onHide: () => void }) {
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const sendCode = () => run(async () => {
    const r = await postJson<{ status: 'SENT' | 'VERIFIED' }>('/public/chatbot/verify/start', { branchId, sessionId: sessionId(), name: name.trim(), phone: phone.trim() });
    if (r.status === 'VERIFIED') onDone();
    else { setCode(''); setStep('code'); }
  });
  const confirm = () => run(async () => {
    await postJson('/public/chatbot/verify/confirm', { branchId, sessionId: sessionId(), code: code.trim() });
    onDone();
  });

  const field = 'w-full bg-bg border border-border px-3 py-2 text-sm outline-none focus:border-accent';
  return (
    <div className="border border-accent bg-card p-3 space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-semibold">{coupon ? `Get ${coupon}% off your first visit` : 'Share your name and number'}</p>
        <button onClick={onHide} aria-label="Not now" className="text-muted hover:text-text text-xs">Not now</button>
      </div>
      {step === 'details' ? (
        <>
          <p className="text-xs text-muted">{coupon ? "We'll text a welcome coupon to your mobile after a quick check." : 'So our team can recognise you and help with bookings faster.'}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your name" autoComplete="name" className={field} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="Mobile number (01XXXXXXXXX)" inputMode="tel" autoComplete="tel" className={field} />
          <button disabled={busy || !name.trim() || phone.replace(/\D/g, '').length < 11} onClick={() => void sendCode()} className="w-full bg-btn text-white py-2 font-bold disabled:opacity-40">
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">We sent a 6-digit code to {phone.trim()}. It expires in 10 minutes.</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code"
            onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void confirm(); }} className={`${field} tracking-[0.4em] text-center`} />
          <button disabled={busy || code.replace(/\D/g, '').length < 4} onClick={() => void confirm()} className="w-full bg-btn text-white py-2 font-bold disabled:opacity-40">
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <div className="flex justify-between text-xs">
            <button onClick={() => { setStep('details'); setError(null); }} className="text-accent underline">Change number</button>
            <button disabled={busy} onClick={() => void sendCode()} className="text-accent underline disabled:opacity-40">Send a new code</button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <p className="text-[10px] text-muted">We use your number only for your bookings and offers from us. <Link to="/privacy" className="underline">Privacy</Link></p>
    </div>
  );
}
