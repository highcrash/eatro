import { AlertTriangle, Image as ImageIcon, MessageCircle, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ago, CHANNEL_COLOR, CHANNEL_LABEL, type Comment, type Complaint, type ConversationSummary } from '../lib/types';
import { Empty, ErrorLine, Header, Pill } from '../ui';

/** Loads a list, reloads it on `refreshKey` changes and every 30 seconds. */
function useList<T>(path: string, refreshKey: number) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<T[]>(path).then(
      (r) => {
        setRows(r);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [path]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  return { rows, error };
}

const CHAT_FILTERS = [
  { key: 'staff', label: 'Needs you' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'human', label: 'With staff' },
  { key: '', label: 'All' },
] as const;

export function ChatsList({ refreshKey }: { refreshKey: number }) {
  const [filter, setFilter] = useState<string>('staff');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const { rows, error } = useList<ConversationSummary>(`/chatbot/conversations?filter=${filter}${query ? `&search=${encodeURIComponent(query)}` : ''}`, refreshKey);

  return (
    <>
      <Header title="Chats" subtitle="Website, Messenger, Instagram, WhatsApp" />
      <div className="px-3 pt-3 space-y-2 bg-cream sticky top-14 z-10 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-white border border-ink-line px-3">
          <Search size={16} className="text-ink-soft" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or words" className="flex-1 py-2.5 text-sm bg-transparent focus:outline-none" />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {CHAT_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${filter === f.key ? 'bg-beet text-white border-beet' : 'bg-white text-ink border-ink-line'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorLine error={error} />
      {rows && rows.length === 0 && <Empty>{filter === 'staff' ? 'Nothing needs you right now. 🎉' : 'No chats here.'}</Empty>}
      <ul className="divide-y divide-ink-line bg-white">
        {rows?.map((c) => (
          <li key={c.id}>
            <button onClick={() => navigate(`/chat/${c.id}`)} className="w-full text-left px-4 py-3 flex gap-3 active:bg-cream">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ background: CHANNEL_COLOR[c.channel] }}>
                {(c.customerName ?? '?').trim().charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{c.customerName || c.customerPhone || 'Customer'}</span>
                  <span className="ml-auto text-xs text-ink-soft shrink-0">{ago(c.lastMessageAt)}</span>
                </div>
                <div className="text-sm text-ink-soft truncate">
                  {c.lastMessage?.status === 'DRAFT' ? '📝 ' : c.lastMessage?.sender === 'CUSTOMER' ? '' : '↩ '}
                  {c.lastMessage?.text ?? ''}
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[11px] font-semibold" style={{ color: CHANNEL_COLOR[c.channel] }}>{CHANNEL_LABEL[c.channel]}</span>
                  {c.needsStaff && <Pill color="#c15c58">{c.needsStaffReason ?? 'Needs you'}</Pill>}
                  {c.drafts > 0 && <Pill color="#E99207">Draft to approve</Pill>}
                  {c.status === 'HUMAN' && <Pill color="#6F6F6F">With staff</Pill>}
                </div>
              </div>
              {c.staffUnread > 0 && <span className="self-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-beet text-white text-xs font-bold flex items-center justify-center">{c.staffUnread}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const COMMENT_FILTERS = [
  { key: 'action', label: 'Needs action' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'spam', label: 'Spam' },
  { key: 'all', label: 'All' },
] as const;

const COMMENT_STATUS: Record<Comment['status'], { label: string; color: string }> = {
  NEW: { label: 'New', color: '#c15c58' },
  DRAFT: { label: 'Draft to approve', color: '#E99207' },
  ESCALATED: { label: 'Complaint', color: '#c15c58' },
  REPLIED: { label: 'Replied', color: '#1FA855' },
  IGNORED: { label: 'Ignored', color: '#9a9a9a' },
  HIDDEN: { label: 'Hidden', color: '#6F6F6F' },
};

export function CommentsList({ refreshKey }: { refreshKey: number }) {
  const [filter, setFilter] = useState<string>('action');
  const { rows, error } = useList<Comment>(`/chatbot/comments?filter=${filter}`, refreshKey);
  return (
    <>
      <Header title="Comments" subtitle="Facebook and Instagram posts" />
      <div className="px-3 py-2 flex gap-2 overflow-x-auto no-scrollbar bg-cream sticky top-14 z-10">
        {COMMENT_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${filter === f.key ? 'bg-beet text-white border-beet' : 'bg-white text-ink border-ink-line'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      {rows && rows.length === 0 && <Empty>No comments here.</Empty>}
      <ul className="divide-y divide-ink-line bg-white">
        {rows?.map((c) => (
          <li key={c.id}>
            <button onClick={() => navigate(`/comments/${c.id}`)} className="w-full text-left px-4 py-3 active:bg-cream">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{c.authorName || 'Someone'}</span>
                <span className="text-[11px] font-semibold" style={{ color: c.platform === 'INSTAGRAM' ? '#C13584' : '#0866FF' }}>{c.platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook'}</span>
                <span className="ml-auto text-xs text-ink-soft">{ago(c.createdAt)}</span>
              </div>
              <div className="text-sm text-ink mt-0.5 line-clamp-2">{c.text}</div>
              <div className="mt-1"><Pill color={COMMENT_STATUS[c.status].color}>{COMMENT_STATUS[c.status].label}</Pill></div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const LEVEL_COLOR = { SERIOUS: '#c62828', ORDINARY: '#E99207', MILD: '#9a9a9a' } as const;

export function ComplaintsList({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState('open');
  const { rows, error } = useList<Complaint>(`/chatbot/complaints?status=${status}`, refreshKey);
  return (
    <>
      <Header title="Complaints" subtitle="A person decides what EATRO says" />
      <div className="px-3 py-2 flex gap-2 bg-cream sticky top-14 z-10">
        {[
          { key: 'open', label: 'Open' },
          { key: 'RESOLVED', label: 'Resolved' },
          { key: '', label: 'All' },
        ].map((f) => (
          <button key={f.key} onClick={() => setStatus(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${status === f.key ? 'bg-beet text-white border-beet' : 'bg-white text-ink border-ink-line'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      {rows && rows.length === 0 && <Empty>No complaints. 🙌</Empty>}
      <ul className="divide-y divide-ink-line bg-white">
        {rows?.map((c) => (
          <li key={c.id}>
            <button onClick={() => navigate(`/complaints/${c.id}`)} className="w-full text-left px-4 py-3 active:bg-cream">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} style={{ color: LEVEL_COLOR[c.level] }} />
                <span className="font-semibold truncate">{c.customerName || 'Customer'}</span>
                {!c.openedAt && <span className="w-2 h-2 rounded-full bg-beet" />}
                <span className="ml-auto text-xs text-ink-soft">{ago(c.createdAt)}</span>
              </div>
              <div className="text-sm text-ink mt-0.5 line-clamp-2">{c.text}</div>
              <div className="flex gap-1.5 mt-1">
                <Pill color={LEVEL_COLOR[c.level]}>{c.level.toLowerCase()}</Pill>
                <Pill color="#6F6F6F">{c.topic.toLowerCase()}</Pill>
                <Pill color={c.status === 'RESOLVED' ? '#1FA855' : '#c15c58'}>{c.status.toLowerCase()}</Pill>
                <span className="text-[11px] text-ink-soft self-center flex items-center gap-1">
                  {c.source === 'COMMENT' ? <ImageIcon size={12} /> : <MessageCircle size={12} />}
                  {c.source === 'COMMENT' ? 'comment' : (c.channel ?? 'chat').toLowerCase()}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
