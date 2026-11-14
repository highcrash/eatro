import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { taka, type Comment, type ComplaintDetail } from '../lib/types';
import { Button, Empty, ErrorLine, Header, Pill } from '../ui';

const TEXTAREA = 'w-full rounded-xl border border-ink-line bg-white p-3 text-[15px] focus:outline-none focus:border-beet';

// ─── Comment ─────────────────────────────────────────────────────────────────

export function CommentScreen({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [c, setC] = useState<Comment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pub, setPub] = useState('');
  const [priv, setPriv] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Comment[]>('/chatbot/comments?filter=all').then(
      (rows) => {
        const row = rows.find((r) => r.id === id) ?? null;
        setC(row);
        if (row) {
          setPub(row.draftPublicReply ?? '');
          setPriv(row.draftPrivateReply ?? '');
        }
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);
  useEffect(load, [load, refreshKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (c === null) return (<><Header onBack="/comments" title="Comment" /><Empty>This comment is no longer in the list.</Empty></>);
  const where = c?.platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook';
  const done = c?.status === 'REPLIED' || c?.status === 'IGNORED';
  return (
    <>
      <Header onBack="/comments" title={c?.authorName || 'Comment'} subtitle={c ? `${where} post comment` : ''} />
      <ErrorLine error={error} />
      {c && (
        <div className="p-3 space-y-3">
          {c.post?.caption && (
            <div className="rounded-xl bg-white border border-ink-line p-3 text-xs text-ink-soft">
              <div className="font-semibold text-ink mb-1">On the post</div>
              <div className="line-clamp-3">{c.post.caption}</div>
              {c.post.permalink && (
                <a href={c.post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-beet mt-1 font-semibold">
                  Open post <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          <div className="rounded-xl bg-white border border-ink-line p-3">
            <div className="text-[15px]">{c.text}</div>
            <div className="flex gap-1.5 mt-2">
              <Pill color="#6F6F6F">{c.kind.toLowerCase()}</Pill>
              <Pill color={done ? '#1FA855' : '#c15c58'}>{c.status.toLowerCase()}</Pill>
              {c.hidden && <Pill color="#6F6F6F">hidden</Pill>}
            </div>
            {c.lastError && <div className="text-xs text-beet-dark mt-2">Last error: {c.lastError}</div>}
          </div>
          {c.publicReply && <div className="text-sm"><span className="font-semibold">Replied publicly:</span> {c.publicReply}</div>}
          {c.privateReplySent && <div className="text-sm text-ink-soft">A private message was sent.</div>}

          {!done && (
            <>
              <label className="block text-xs font-semibold text-ink-soft">Public reply (under the comment)</label>
              <textarea value={pub} onChange={(e) => setPub(e.target.value)} rows={3} className={TEXTAREA} placeholder="Leave empty for no public reply" />
              <label className="block text-xs font-semibold text-ink-soft">Private message (sent to their inbox, once)</label>
              <textarea value={priv} onChange={(e) => setPriv(e.target.value)} rows={4} className={TEXTAREA} placeholder="Leave empty for no private message" disabled={c.privateReplySent} />
              <Button disabled={busy || (!pub.trim() && !priv.trim())} onClick={() => void act(() => api.post(`/chatbot/comments/${c.id}/approve`, { publicReply: pub.trim() || null, privateReply: c.privateReplySent ? null : priv.trim() || null }))} className="w-full">
                Send
              </Button>
            </>
          )}
          <div className="flex gap-2">
            <Button kind="ghost" disabled={busy} onClick={() => void act(() => api.post(`/chatbot/comments/${c.id}/hide`, { hidden: !c.hidden }))} className="flex-1">
              {c.hidden ? 'Unhide' : 'Hide'}
            </Button>
            {!done && (
              <Button kind="ghost" disabled={busy} onClick={() => void act(() => api.post(`/chatbot/comments/${c.id}/dismiss`))} className="flex-1">
                No reply needed
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Complaint ───────────────────────────────────────────────────────────────

const OUTCOMES = ['Apologised', 'Replacement given', 'Voucher given', 'Refund given', 'No action needed'];

export function ComplaintScreen({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [c, setC] = useState<ComplaintDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<ComplaintDetail>(`/chatbot/complaints/${id}`).then(
      (r) => {
        setC(r);
        setNotes(r.notes ?? '');
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);
  useEffect(load, [load, refreshKey]);

  const update = async (data: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      // The update answers with the bare complaint; keep the orders and comment already shown.
      const saved = await api.patch<Partial<ComplaintDetail>>(`/chatbot/complaints/${id}`, data);
      setC((prev) => (prev ? { ...prev, ...saved, recentOrders: prev.recentOrders, comment: prev.comment } : prev));
      if (typeof saved.notes !== 'undefined') setNotes(saved.notes ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header onBack="/complaints" title={c?.customerName || 'Complaint'} subtitle={c ? `${c.level.toLowerCase()} · ${c.topic.toLowerCase()} · ${c.status.toLowerCase()}` : ''} />
      <ErrorLine error={error} />
      {c && (
        <div className="p-3 space-y-3">
          <div className="rounded-xl bg-white border border-ink-line p-3 text-[15px] whitespace-pre-wrap">{c.text}</div>
          {c.customerPhone && <div className="text-sm">Phone: <a className="text-beet font-semibold" href={`tel:${c.customerPhone}`}>{c.customerPhone}</a></div>}
          {c.conversationId && (
            <Button kind="ghost" onClick={() => navigate(`/chat/${c.conversationId}`)} className="w-full">
              Open the chat to reply
            </Button>
          )}
          {c.source === 'COMMENT' && c.comment && !c.comment.publicReply && (
            <div className="text-xs text-ink-soft">Reply to this comment from the Comments tab.</div>
          )}

          <div className="rounded-xl bg-white border border-ink-line p-3 space-y-2">
            <div className="text-xs font-semibold text-ink-soft">Status</div>
            <div className="flex gap-2">
              {(['NEW', 'CONTACTED', 'RESOLVED'] as const).map((s) => (
                <button key={s} disabled={busy} onClick={() => void update({ status: s })} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${c.status === s ? 'bg-beet text-white border-beet' : 'bg-white border-ink-line'}`}>
                  {s.toLowerCase()}
                </button>
              ))}
            </div>
            <div className="text-xs font-semibold text-ink-soft pt-1">Outcome</div>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button key={o} disabled={busy} onClick={() => void update({ outcome: o })} className={`px-2.5 py-1.5 rounded-full text-xs border ${c.outcome === o ? 'bg-beet text-white border-beet' : 'bg-white border-ink-line'}`}>
                  {o}
                </button>
              ))}
            </div>
            <div className="text-xs font-semibold text-ink-soft pt-1">Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={TEXTAREA} placeholder="What happened, who called them…" />
            <Button kind="ghost" disabled={busy || notes === (c.notes ?? '')} onClick={() => void update({ notes: notes.trim() || null })} className="w-full">
              Save notes
            </Button>
          </div>

          {(c.recentOrders ?? []).length > 0 && (
            <div className="rounded-xl bg-white border border-ink-line p-3">
              <div className="text-xs font-semibold text-ink-soft mb-2">Their recent orders</div>
              {(c.recentOrders ?? []).map((o) => (
                <div key={o.id} className="text-sm py-1 border-b border-ink-line last:border-0">
                  <div className="flex justify-between">
                    <span>#{o.orderNumber} · {new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    <span className="font-semibold">{taka(Number(o.totalAmount) / 100)}</span>
                  </div>
                  <div className="text-xs text-ink-soft">{(o.items ?? []).map((i) => `${i.quantity}× ${i.menuItemName}`).join(', ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
