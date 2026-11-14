import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, RotateCcw, Send } from 'lucide-react';

import { api } from '../../lib/api';
import { CARD, Cards, ChatbotSettings, ChatMode, friendly, GHOST, HINT, INPUT, LABEL, MenuCard, PRIMARY, shrinkPhoto } from './shared';

const MODES: { value: ChatMode; label: string }[] = [
  { value: 'OFF', label: 'Off' },
  { value: 'SUGGEST', label: 'Suggest (staff approve each reply)' },
  { value: 'AUTO', label: 'Auto (bot replies)' },
];

export default function SettingsTab() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
      <SettingsForm />
      <TestBot />
    </div>
  );
}

function SettingsForm() {
  const qc = useQueryClient();
  const { data } = useQuery<ChatbotSettings>({ queryKey: ['chat-settings'], queryFn: () => api.get('/chatbot/settings') });
  const [f, setF] = useState<ChatbotSettings | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = useMutation({
    mutationFn: () => api.patch('/chatbot/settings', {
      webMode: f!.webMode, messengerMode: f!.messengerMode, instagramMode: f!.instagramMode, commentMode: f!.commentMode, whatsappMode: f!.whatsappMode, whatsappMonthlyCap: f!.whatsappMonthlyCap,
      assistantName: f!.assistantName, greeting: f!.greeting, fallbackText: f!.fallbackText,
      visionEnabled: f!.visionEnabled, imageDailyLimit: f!.imageDailyLimit, humanPauseHours: f!.humanPauseHours, retentionDays: f!.retentionDays, usdRate: f!.usdRate,
      autoHideSpam: f!.autoHideSpam, complaintMode: f!.complaintMode, complaintReminderMins: f!.complaintReminderMins,
      managerPhone: f!.managerPhone ?? '', complaintSmsEnabled: f!.complaintSmsEnabled, commentHourlyCap: f!.commentHourlyCap,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-settings'] }),
  });
  const pageConnected = !!data?.pageConnected;
  const igConnected = !!data?.instagramConnected;
  if (!f) return null;
  const set = (p: Partial<ChatbotSettings>) => setF({ ...f, ...p });

  return (
    <div className="space-y-6">
      <section className={`${CARD} p-4 space-y-3`}>
        <h2 className="font-display text-xl text-white tracking-wide">CHANNELS</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Website chat (eatrobd.com)</label>
            <select value={f.webMode} onChange={(e) => set({ webMode: e.target.value as ChatMode })} className={`w-full ${INPUT}`}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className={`${HINT} mt-1`}>Off hides the chat bubble on the website.</p>
          </div>
          {([
            { key: 'messengerMode', label: 'Facebook Messenger', ok: pageConnected },
            { key: 'instagramMode', label: 'Instagram DMs', ok: igConnected },
            { key: 'commentMode', label: 'Facebook and Instagram comments', ok: pageConnected },
          ] as const).map((c) => (
            <div key={c.key}>
              <label className={LABEL}>{c.label}</label>
              <select value={f[c.key]} disabled={!c.ok && f[c.key] === 'OFF'} onChange={(e) => set({ [c.key]: e.target.value as ChatMode } as Partial<ChatbotSettings>)} className={`w-full ${INPUT} ${!c.ok && f[c.key] === 'OFF' ? 'opacity-50' : ''}`}>
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              {!c.ok && <p className={`${HINT} mt-1`}>Connect the Facebook Page{c.key === 'instagramMode' ? ' with its Instagram account' : ''} in the Connect tab first.</p>}
            </div>
          ))}
          <div>
            <label className={LABEL}>WhatsApp</label>
            <select value={f.whatsappMode} disabled={!data?.whatsappConnected && f.whatsappMode === 'OFF'} onChange={(e) => set({ whatsappMode: e.target.value as ChatMode })} className={`w-full ${INPUT} ${!data?.whatsappConnected && f.whatsappMode === 'OFF' ? 'opacity-50' : ''}`}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {!data?.whatsappConnected && <p className={`${HINT} mt-1`}>Add the WhatsApp number in Settings → WhatsApp, then use Connect WhatsApp in the Connect tab.</p>}
          </div>
        </div>
        {data?.whatsappConnected && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[#222] pt-3">
            <div>
              <label className={LABEL}>WhatsApp replies per month before the bot stops</label>
              <input type="number" min={0} value={f.whatsappMonthlyCap} onChange={(e) => set({ whatsappMonthlyCap: Number(e.target.value) })} className={`w-full ${INPUT}`} />
              <p className={`${HINT} mt-1`}>Meta gives 1,000 free replies a month per number and charges after that. When the limit is reached, chats go to staff instead.</p>
            </div>
            <div>
              <label className={LABEL}>This month</label>
              {(() => {
                const used = data.whatsappSentThisMonth ?? 0;
                const color = used >= f.whatsappMonthlyCap ? 'text-[#F03535]' : used >= 800 ? 'text-[#FFA726]' : 'text-white';
                return (
                  <p className={`font-display text-3xl ${color}`}>{used.toLocaleString('en-US')} <span className="text-[#666] text-base font-body">of {f.whatsappMonthlyCap.toLocaleString('en-US')}</span></p>
                );
              })()}
              {(data.whatsappSentThisMonth ?? 0) >= 800 && <p className="text-[#FFA726] text-xs font-body mt-1">Close to Meta's free 1,000. Make sure a payment method is set in WhatsApp Manager if you raise the limit.</p>}
            </div>
          </div>
        )}
        <p className={HINT}>Suggested start for social channels: Suggest for the first week, then Auto once the replies look right.</p>
      </section>

      <section className={`${CARD} p-4 space-y-3`}>
        <h2 className="font-display text-xl text-white tracking-wide">COMPLAINTS AND COMMENTS</h2>
        <div>
          <label className={LABEL}>First response to a complaint in a comment</label>
          <select value={f.complaintMode} onChange={(e) => set({ complaintMode: e.target.value as ChatbotSettings['complaintMode'] })} className={`w-full ${INPUT}`}>
            <option value="DRAFT">Draft for approval: nothing is posted until staff send it (recommended)</option>
            <option value="HOLDING">Holding reply: a short apology goes out at once for ordinary complaints; serious ones still wait for staff</option>
            <option value="STAFF_ONLY">Staff only: alert, no draft</option>
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm font-body text-[#ccc]">
          <input type="checkbox" checked={f.autoHideSpam} onChange={(e) => set({ autoHideSpam: e.target.checked })} className="mt-1" />
          <span>Hide swearing and spam links automatically<br /><span className={HINT}>Real complaints are never hidden. Hidden comments can be shown again from the Comments tab.</span></span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={LABEL}>Remind about unopened serious complaints after (minutes)</label>
            <input type="number" min={5} max={240} value={f.complaintReminderMins} onChange={(e) => set({ complaintReminderMins: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Public comment replies per hour</label>
            <input type="number" min={1} max={500} value={f.commentHourlyCap} onChange={(e) => set({ commentHourlyCap: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Manager phone for serious complaints</label>
            <input value={f.managerPhone ?? ''} onChange={(e) => set({ managerPhone: e.target.value })} placeholder="01XXXXXXXXX" className={`w-full ${INPUT}`} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-body text-[#ccc]">
          <input type="checkbox" checked={f.complaintSmsEnabled} onChange={(e) => set({ complaintSmsEnabled: e.target.checked })} /> Send an SMS to the manager for serious complaints (uses your SMS balance)
        </label>
      </section>

      <section className={`${CARD} p-4 space-y-3`}>
        <h2 className="font-display text-xl text-white tracking-wide">HOW IT SPEAKS</h2>
        <div>
          <label className={LABEL}>Assistant name</label>
          <input value={f.assistantName} onChange={(e) => set({ assistantName: e.target.value })} className={`w-full ${INPUT}`} />
        </div>
        <div>
          <label className={LABEL}>Greeting shown when the chat opens</label>
          <textarea value={f.greeting} onChange={(e) => set({ greeting: e.target.value })} rows={2} className={`w-full ${INPUT}`} />
        </div>
        <div>
          <label className={LABEL}>Reply when the AI can't answer</label>
          <textarea value={f.fallbackText} onChange={(e) => set({ fallbackText: e.target.value })} rows={2} className={`w-full ${INPUT}`} />
          <p className={`${HINT} mt-1`}>Sent when no AI is available or a reply fails the price check. The chat is flagged for staff at the same time.</p>
        </div>
      </section>

      <section className={`${CARD} p-4 space-y-3`}>
        <h2 className="font-display text-xl text-white tracking-wide">PHOTOS, STAFF AND PRIVACY</h2>
        <label className="flex items-start gap-2 text-sm font-body text-[#ccc]">
          <input type="checkbox" checked={f.visionEnabled} onChange={(e) => set({ visionEnabled: e.target.checked })} className="mt-1" />
          <span>Recognise dishes in customer photos<br /><span className={HINT}>Photos are sent to the AI under "Photo recognition". Free providers may keep or learn from them, so this is off until you choose it.</span></span>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={LABEL}>Photos per customer per day</label>
            <input type="number" min={0} max={50} value={f.imageDailyLimit} onChange={(e) => set({ imageDailyLimit: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Bot quiet after staff reply (hours)</label>
            <input type="number" min={1} max={168} value={f.humanPauseHours} onChange={(e) => set({ humanPauseHours: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Keep chats (days)</label>
            <input type="number" min={7} max={365} value={f.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Taka per US dollar</label>
            <input type="number" min={1} step="0.01" value={f.usdRate} onChange={(e) => set({ usdRate: Number(e.target.value) })} className={`w-full ${INPUT}`} />
          </div>
        </div>
      </section>
      {save.error && <p className="text-[#F03535] text-xs font-body">{friendly(save.error)}</p>}
      <button onClick={() => save.mutate()} disabled={save.isPending} className={PRIMARY}>{save.isSuccess && !save.isPending ? 'Saved' : 'Save settings'}</button>
    </div>
  );
}

interface TestLine { from: 'you' | 'bot'; text: string; cards?: MenuCard[]; note?: string }

/** Chats with the real pipeline (pre-ready answers, AI, price check). Bookings and enquiries are not saved. */
function TestBot() {
  const [session, setSession] = useState(() => Math.random().toString(36).slice(2, 12));
  const [lines, setLines] = useState<TestLine[]>([]);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [lines.length]);

  const send = useMutation({
    mutationFn: (body: { text: string; image?: string }) =>
      api.post<{ status: string; reply: { text: string; cards: MenuCard[]; source: string } | null }>('/chatbot/test', { sessionKey: session, ...body }),
    onSuccess: (res) =>
      setLines((l) => [...l, res.reply ? { from: 'bot', text: res.reply.text, cards: res.reply.cards, note: res.reply.source.replace('_', ' ').toLowerCase() } : { from: 'bot', text: '(no reply)', note: res.status.toLowerCase() }]),
    onError: (e) => setLines((l) => [...l, { from: 'bot', text: friendly(e), note: 'error' }]),
  });
  const reset = useMutation({ mutationFn: () => api.post('/chatbot/test/reset', { sessionKey: session }), onSuccess: () => { setLines([]); setSession(Math.random().toString(36).slice(2, 12)); } });
  const go = () => {
    if (!text.trim() || send.isPending) return;
    setLines((l) => [...l, { from: 'you', text }]);
    send.mutate({ text });
    setText('');
  };
  const photo = async (file: File) => {
    const image = await shrinkPhoto(file);
    setLines((l) => [...l, { from: 'you', text: '[photo]' }]);
    send.mutate({ text: '', image });
  };

  return (
    <div className={`${CARD} flex flex-col h-[640px]`}>
      <div className="p-3 border-b border-[#2A2A2A] flex items-center">
        <div className="flex-1">
          <p className="text-white font-body text-sm">Test the bot</p>
          <p className={HINT}>Real answers, nothing saved. Works even when the website chat is off.</p>
        </div>
        <button onClick={() => reset.mutate()} className={`${GHOST} !px-2 !py-1`} title="Start over"><RotateCcw size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.length === 0 && <p className={HINT}>Try: "kokhon khole?", "pizza price koto?", "birthday party for 40, cost per head?", "book a table for 4 tomorrow 8pm".</p>}
        {lines.map((l, i) => (
          <div key={i} className={`flex ${l.from === 'you' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 border ${l.from === 'you' ? 'border-[#D62B2B]/40 bg-[#D62B2B]/10' : 'border-[#2A2A2A] bg-[#0D0D0D]'}`}>
              <p className="text-white text-sm font-body whitespace-pre-wrap">{l.text}</p>
              <Cards cards={l.cards} />
              {l.note && <p className="text-[#555] text-[10px] font-body mt-1 uppercase tracking-widest">{l.note}</p>}
            </div>
          </div>
        ))}
        {send.isPending && <p className={HINT}>Thinking…</p>}
        <div ref={bottom} />
      </div>
      <div className="p-3 border-t border-[#2A2A2A] flex gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void photo(f); e.target.value = ''; }} />
        <button onClick={() => fileRef.current?.click()} className={`${GHOST} !px-2`} title="Send a photo"><ImageIcon size={14} /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} placeholder="Write as a customer…" className={`flex-1 ${INPUT}`} />
        <button onClick={go} disabled={!text.trim() || send.isPending} className={PRIMARY}><Send size={14} /></button>
      </div>
    </div>
  );
}
