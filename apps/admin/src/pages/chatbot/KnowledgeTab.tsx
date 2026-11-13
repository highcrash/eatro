import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';

import { api } from '../../lib/api';
import { CARD, ChatbotSettings, Dialog, fmtTime, friendly, GHOST, HINT, INPUT, LABEL, PRIMARY } from './shared';

interface QuickReply { id: string; title: string; keywords: string; answer: string; isActive: boolean; priority: number; hits: number }
interface RulesData { current: string[]; history: { id: string; rules: string[]; createdAt: string; createdByName: string | null }[] }
interface Unanswered { id: string; question: string; reason: string; createdAt: string; resolved: boolean }

type Draft = Partial<QuickReply> & { id?: string };

export default function KnowledgeTab() {
  const [editing, setEditing] = useState<Draft | null>(null);
  return (
    <div className="space-y-8">
      <QuickReplies onEdit={setEditing} />
      <Rules />
      <PartyGuidance />
      <UnansweredList onMakeReply={(q) => setEditing({ title: q.slice(0, 40), keywords: q, answer: '' })} />
      {editing && <QuickReplyDialog draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function QuickReplies({ onEdit }: { onEdit: (d: Draft) => void }) {
  const qc = useQueryClient();
  const [probe, setProbe] = useState('');
  const { data = [] } = useQuery<QuickReply[]>({ queryKey: ['chat-quick-replies'], queryFn: () => api.get('/chatbot/quick-replies') });
  const toggle = useMutation({
    mutationFn: (r: QuickReply) => api.patch(`/chatbot/quick-replies/${r.id}`, { isActive: !r.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-quick-replies'] }),
  });
  const test = useMutation<{ matched: boolean; title: string | null; answer: string | null }>({ mutationFn: () => api.post('/chatbot/quick-replies/test', { text: probe }) });

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl text-white tracking-wide">PRE-READY ANSWERS</h2>
          <p className={HINT}>Answered instantly with no AI. A short message that contains one of the phrases gets the answer. Use {'{openingHours}'}, {'{address}'}, {'{phone}'}, {'{menuUrl}'}, {'{reservationUrl}'} for live details.</p>
        </div>
        <button onClick={() => onEdit({ title: '', keywords: '', answer: '' })} className={PRIMARY}><Plus size={14} className="inline mr-1" />Add answer</button>
      </div>
      <div className={`${CARD} divide-y divide-[#222]`}>
        {data.map((r) => (
          <div key={r.id} className="p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className={`font-body text-sm ${r.isActive ? 'text-white' : 'text-[#555] line-through'}`}>{r.title} <span className="text-[#555] text-xs ml-2">used {r.hits}×</span></p>
              <p className="text-[#888] text-xs font-body truncate">{r.keywords.split('\n').join(' · ')}</p>
              <p className="text-[#aaa] text-xs font-body mt-1 whitespace-pre-wrap line-clamp-2">{r.answer}</p>
            </div>
            <button onClick={() => toggle.mutate(r)} className={`${GHOST} !px-2 !py-1 text-xs`}>{r.isActive ? 'Turn off' : 'Turn on'}</button>
            <button onClick={() => onEdit(r)} className={`${GHOST} !px-2 !py-1 text-xs`}>Edit</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-start">
        <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Try a customer message, e.g. kokhon khole?" className={`flex-1 ${INPUT}`} />
        <button onClick={() => test.mutate()} disabled={!probe.trim()} className={GHOST}>Which answer fires?</button>
      </div>
      {test.data && (
        <p className="text-sm font-body text-[#ccc] whitespace-pre-wrap">
          {test.data.matched ? <>→ <b>{test.data.title}</b>: {test.data.answer}</> : '→ No pre-ready answer. The AI would reply.'}
        </p>
      )}
    </section>
  );
}

function QuickReplyDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: draft.title ?? '', keywords: draft.keywords ?? '', answer: draft.answer ?? '', priority: draft.priority ?? 0 });
  const save = useMutation({
    mutationFn: () => (draft.id ? api.patch(`/chatbot/quick-replies/${draft.id}`, form) : api.post('/chatbot/quick-replies', form)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat-quick-replies'] }); onClose(); },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/chatbot/quick-replies/${draft.id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat-quick-replies'] }); onClose(); },
  });
  return (
    <Dialog title={draft.id ? 'EDIT ANSWER' : 'NEW ANSWER'} onClose={onClose} wide>
      <div>
        <label className={LABEL}>Title</label>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={`w-full ${INPUT}`} placeholder="e.g. Parking" />
      </div>
      <div>
        <label className={LABEL}>Phrases, one per line (English, Bangla, Banglish)</label>
        <textarea value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} rows={5} className={`w-full ${INPUT}`} placeholder={'parking\nparking ache\nপার্কিং'} />
      </div>
      <div>
        <label className={LABEL}>Answer</label>
        <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={4} className={`w-full ${INPUT}`} />
      </div>
      <div>
        <label className={LABEL}>Priority (higher wins when two match exactly)</label>
        <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className={`w-32 ${INPUT}`} />
      </div>
      {(save.error || remove.error) && <p className="text-[#F03535] text-xs font-body">{friendly(save.error ?? remove.error)}</p>}
      <div className="flex gap-3">
        {draft.id && <button onClick={() => { if (confirm('Delete this answer?')) remove.mutate(); }} className={GHOST}><Trash2 size={14} /></button>}
        <button onClick={onClose} className={`flex-1 ${GHOST}`}>Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending} className={`flex-1 ${PRIMARY}`}>Save</button>
      </div>
    </Dialog>
  );
}

function Rules() {
  const qc = useQueryClient();
  const { data } = useQuery<RulesData>({ queryKey: ['chat-rules'], queryFn: () => api.get('/chatbot/rules') });
  const [text, setText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { if (data) setText(data.current.join('\n')); }, [data]);
  const save = useMutation({ mutationFn: () => api.put('/chatbot/rules', { rules: text.split('\n') }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-rules'] }) });
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/chatbot/rules/${id}/restore`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-rules'] }) });
  const dirty = data && text.trim() !== data.current.join('\n').trim();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl text-white tracking-wide">TEACH THE BOT</h2>
        <p className={HINT}>Facts and rules in plain words, one per line. The bot follows them and may tell customers. Every save is kept, so you can undo.</p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className={`w-full ${INPUT}`}
        placeholder={'Outside cake is allowed for birthdays; tell us when booking.\nWe do not deliver ourselves; order through Foodpanda.\nParties over 30 guests need a ৳5,000 advance.\nWe have free parking for 6 cars.'} />
      <div className="flex gap-3 items-center">
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className={PRIMARY}>Save rules</button>
        <button onClick={() => setShowHistory((s) => !s)} className={GHOST}>{showHistory ? 'Hide' : 'Show'} earlier versions</button>
        {save.error && <span className="text-[#F03535] text-xs font-body">{friendly(save.error)}</span>}
      </div>
      {showHistory && (
        <div className={`${CARD} divide-y divide-[#222]`}>
          {(data?.history ?? []).slice(1).map((v) => (
            <div key={v.id} className="p-3 flex gap-3 items-start">
              <div className="flex-1">
                <p className={HINT}>{fmtTime(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ''} · {v.rules.length} rules</p>
                <p className="text-[#aaa] text-xs font-body whitespace-pre-wrap line-clamp-3">{v.rules.join('\n')}</p>
              </div>
              <button onClick={() => restore.mutate(v.id)} className={`${GHOST} !px-2 !py-1 text-xs`}>Restore</button>
            </div>
          ))}
          {(data?.history.length ?? 0) <= 1 && <p className={`${HINT} p-3`}>No earlier versions yet.</p>}
        </div>
      )}
    </section>
  );
}

function PartyGuidance() {
  const qc = useQueryClient();
  const { data } = useQuery<ChatbotSettings>({ queryKey: ['chat-settings'], queryFn: () => api.get('/chatbot/settings') });
  const [text, setText] = useState('');
  useEffect(() => { if (data) setText(data.partyRules ?? ''); }, [data]);
  const save = useMutation({ mutationFn: () => api.patch('/chatbot/settings', { partyRules: text }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-settings'] }) });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl text-white tracking-wide">PARTY QUOTES</h2>
        <p className={HINT}>How the bot should build party options. The bot chooses dishes; prices, VAT and service charge are always worked out from the live menu.</p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className={`w-full ${INPUT}`}
        placeholder={'For each guest: 1 main and 1 drink. 1 starter per 4 guests.\nPrefer combos and sets for groups.\nValue option should stay under ৳600 per head.'} />
      <button onClick={() => save.mutate()} disabled={save.isPending || text === (data?.partyRules ?? '')} className={PRIMARY}>Save</button>
    </section>
  );
}

function UnansweredList({ onMakeReply }: { onMakeReply: (q: string) => void }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery<Unanswered[]>({ queryKey: ['chat-unanswered'], queryFn: () => api.get('/chatbot/unanswered') });
  const done = useMutation({ mutationFn: (id: string) => api.post(`/chatbot/unanswered/${id}/resolve`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-unanswered'] }) });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl text-white tracking-wide">UNANSWERED QUESTIONS</h2>
        <p className={HINT}>Questions the bot passed to staff or could not answer. Turn common ones into a pre-ready answer or a rule.</p>
      </div>
      <div className={`${CARD} divide-y divide-[#222]`}>
        {data.length === 0 && <p className={`${HINT} p-3`}>Nothing waiting.</p>}
        {data.map((u) => (
          <div key={u.id} className="p-3 flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-body">{u.question || '(photo)'}</p>
              <p className={HINT}>{fmtTime(u.createdAt)} · {u.reason}</p>
            </div>
            <button onClick={() => onMakeReply(u.question)} className={`${GHOST} !px-2 !py-1 text-xs`}>Make answer</button>
            <button onClick={() => done.mutate(u.id)} className={`${GHOST} !px-2 !py-1 text-xs`}>Done</button>
          </div>
        ))}
      </div>
    </section>
  );
}
