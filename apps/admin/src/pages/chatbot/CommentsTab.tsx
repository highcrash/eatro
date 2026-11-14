import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Eye, MessageCircle, Send, ThumbsUp } from 'lucide-react';

import { api } from '../../lib/api';
import { CARD, fmtTime, friendly, GHOST, HINT, INPUT, PRIMARY } from './shared';

interface Comment {
  id: string;
  platform: 'FACEBOOK' | 'INSTAGRAM';
  postId: string;
  commentId: string;
  authorName: string | null;
  text: string;
  kind: string;
  status: 'NEW' | 'DRAFT' | 'REPLIED' | 'ESCALATED' | 'IGNORED' | 'HIDDEN';
  draftPublicReply: string | null;
  draftPrivateReply: string | null;
  publicReply: string | null;
  privateReplySent: boolean;
  liked: boolean;
  hidden: boolean;
  lastError: string | null;
  createdAt: string;
  post: { caption: string | null; permalink: string | null } | null;
}

const FILTERS = [
  { key: 'action', label: 'Needs action' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'spam', label: 'Spam & abuse' },
  { key: 'all', label: 'All' },
] as const;
const KIND_COLOR: Record<string, string> = { COMPLAINT: '#F03535', SPAM: '#FFA726', ABUSE: '#FFA726', PRICE: '#4A90E2', BOOKING: '#4CAF50', INFO: '#999', PRAISE: '#E1306C', OTHER: '#999' };
const STATUS_LABEL: Record<Comment['status'], string> = { NEW: 'Waiting', DRAFT: 'Draft to approve', REPLIED: 'Answered', ESCALATED: 'With staff', IGNORED: 'Skipped', HIDDEN: 'Hidden' };

export default function CommentsTab() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('action');
  const { data = [] } = useQuery<Comment[]>({ queryKey: ['chat-comments', filter], queryFn: () => api.get(`/chatbot/comments?filter=${filter}`), refetchInterval: 15_000 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`text-xs font-body px-3 py-1.5 border ${filter === f.key ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-[#2A2A2A] text-[#888] hover:text-white'}`}>{f.label}</button>
        ))}
        <p className={`${HINT} ml-auto`}>Comments on your Facebook and Instagram posts. Complaints are never answered automatically unless you chose the holding reply.</p>
      </div>
      <div className="space-y-3">
        {data.length === 0 && <div className={`${CARD} p-4`}><p className={HINT}>Nothing here. Comments appear once the Page is connected and comment replies are switched on in Settings.</p></div>}
        {data.map((c) => <CommentCard key={c.id} c={c} />)}
      </div>
    </div>
  );
}

function CommentCard({ c }: { c: Comment }) {
  const qc = useQueryClient();
  const [pub, setPub] = useState(c.draftPublicReply ?? '');
  const [priv, setPriv] = useState(c.draftPrivateReply ?? '');
  const [reply, setReply] = useState('');
  const [dm, setDm] = useState('');
  const done = () => void qc.invalidateQueries({ queryKey: ['chat-comments'] });
  const approve = useMutation({ mutationFn: () => api.post(`/chatbot/comments/${c.id}/approve`, { publicReply: pub || null, privateReply: priv || null }), onSuccess: done });
  const send = useMutation({ mutationFn: () => api.post(`/chatbot/comments/${c.id}/reply`, { text: reply }), onSuccess: () => { setReply(''); done(); } });
  const sendDm = useMutation({ mutationFn: () => api.post(`/chatbot/comments/${c.id}/private`, { text: dm }), onSuccess: () => { setDm(''); done(); } });
  const like = useMutation({ mutationFn: () => api.post(`/chatbot/comments/${c.id}/like`, {}), onSuccess: done });
  const hide = useMutation({ mutationFn: (hidden: boolean) => api.post(`/chatbot/comments/${c.id}/hide`, { hidden }), onSuccess: done });
  const dismiss = useMutation({ mutationFn: () => api.post(`/chatbot/comments/${c.id}/dismiss`, {}), onSuccess: done });
  const error = approve.error ?? send.error ?? sendDm.error ?? like.error ?? hide.error ?? dismiss.error;
  const hasDraft = !!(c.draftPublicReply || c.draftPrivateReply);

  return (
    <div className={`${CARD} p-4 space-y-2 ${c.kind === 'COMPLAINT' ? 'border-l-2 border-l-[#F03535]' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-body tracking-widest uppercase px-1.5 py-0.5 border" style={{ color: c.platform === 'INSTAGRAM' ? '#E1306C' : '#4A90E2', borderColor: '#2A2A2A' }}>{c.platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook'}</span>
        <span className="text-[10px] font-body tracking-widest uppercase" style={{ color: KIND_COLOR[c.kind] ?? '#999' }}>{c.kind.toLowerCase()}</span>
        <span className="text-white text-sm font-body">{c.authorName ?? 'Someone'}</span>
        <span className={HINT}>{fmtTime(c.createdAt)} · {STATUS_LABEL[c.status]}{c.hidden ? ' · hidden' : ''}{c.liked ? ' · liked' : ''}{c.privateReplySent ? ' · messaged' : ''}</span>
        {c.post?.permalink && <a href={c.post.permalink} target="_blank" rel="noreferrer" className="text-[#D62B2B] text-xs font-body ml-auto">View post</a>}
      </div>
      {c.post?.caption && <p className="text-[#666] text-xs font-body line-clamp-1">On: {c.post.caption}</p>}
      <p className="text-white text-sm font-body whitespace-pre-wrap">{c.text}</p>
      {c.publicReply && <p className="text-[#aaa] text-xs font-body border-l-2 border-[#333] pl-2">Page replied: {c.publicReply}</p>}
      {c.lastError && <p className="text-[#FFA726] text-xs font-body">{c.lastError}</p>}

      {hasDraft && (
        <div className="space-y-2 border-t border-[#222] pt-2">
          <p className="text-[#FFA726] text-xs font-body">Suggested reply, not sent yet. Edit if you like, then send.</p>
          <textarea value={pub} onChange={(e) => setPub(e.target.value)} rows={2} placeholder="Public reply under the comment (leave empty to skip)" className={`w-full ${INPUT}`} />
          {!c.privateReplySent && <textarea value={priv} onChange={(e) => setPriv(e.target.value)} rows={3} placeholder="Private message to the person (leave empty to skip)" className={`w-full ${INPUT}`} />}
          <button onClick={() => approve.mutate()} disabled={approve.isPending || (!pub.trim() && !priv.trim())} className={PRIMARY}>Send</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[#222] pt-2">
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply publicly…" className={`flex-1 min-w-[200px] ${INPUT}`} />
        <button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending} className={`${GHOST} !px-3`} title="Reply under the comment"><Send size={14} /></button>
        {!c.privateReplySent && (
          <>
            <input value={dm} onChange={(e) => setDm(e.target.value)} placeholder="Message privately…" className={`flex-1 min-w-[200px] ${INPUT}`} />
            <button onClick={() => sendDm.mutate()} disabled={!dm.trim() || sendDm.isPending} className={`${GHOST} !px-3`} title="Private message (one per comment, within 7 days)"><MessageCircle size={14} /></button>
          </>
        )}
        {c.platform === 'FACEBOOK' && !c.liked && <button onClick={() => like.mutate()} className={`${GHOST} !px-3`} title="Like"><ThumbsUp size={14} /></button>}
        <button onClick={() => hide.mutate(!c.hidden)} className={`${GHOST} !px-3`} title={c.hidden ? 'Unhide' : 'Hide'}>{c.hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
        {c.status !== 'IGNORED' && c.status !== 'REPLIED' && <button onClick={() => dismiss.mutate()} className={`${GHOST} !px-3 text-xs`}>No reply needed</button>}
      </div>
      {error && <p className="text-[#F03535] text-xs font-body">{friendly(error)}</p>}
    </div>
  );
}
