import { AlertTriangle, MessageCircle, MessagesSquare, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from './lib/api';
import { useAuth } from './lib/auth';
import { chime, useLive } from './lib/live';
import { resync } from './lib/push';
import { navigate, usePath } from './lib/router';
import type { Comment, Complaint, ConversationSummary } from './lib/types';
import ChatScreen from './screens/ChatScreen';
import { CommentScreen, ComplaintScreen } from './screens/Detail';
import { ChatsList, CommentsList, ComplaintsList } from './screens/Lists';
import Login from './screens/Login';
import Settings, { useLogout } from './screens/Settings';
import { Button } from './ui';

interface Me { id: string; name: string; role: string; branchId: string; branchName: string }
interface Counts { chats: number; comments: number; complaints: number; alarm: string }

/** Badge counts for the tab bar, plus a fingerprint that changes when something new needs staff. */
function useCounts(enabled: boolean, refreshKey: number): Counts {
  const [counts, setCounts] = useState<Counts>({ chats: 0, comments: 0, complaints: 0, alarm: '' });
  const load = useCallback(async () => {
    if (!enabled) return;
    const [chats, comments, complaints] = await Promise.all([
      api.get<ConversationSummary[]>('/chatbot/conversations?filter=staff').catch(() => [] as ConversationSummary[]),
      api.get<Comment[]>('/chatbot/comments?filter=action').catch(() => [] as Comment[]),
      api.get<Complaint[]>('/chatbot/complaints?status=open').catch(() => [] as Complaint[]),
    ]);
    const fresh = complaints.filter((c) => !c.openedAt);
    setCounts({
      chats: chats.length,
      comments: comments.length,
      complaints: fresh.length,
      alarm: [...chats.map((c) => `${c.id}:${c.staffUnread}`), ...comments.map((c) => c.id), ...fresh.map((c) => c.id)].sort().join('|'),
    });
  }, [enabled]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  return counts;
}

function TabBar({ path, counts }: { path: string; counts: Counts }) {
  const tabs = [
    { to: '/', label: 'Chats', icon: MessagesSquare, count: counts.chats, active: path === '/' || path.startsWith('/chat/') },
    { to: '/comments', label: 'Comments', icon: MessageCircle, count: counts.comments, active: path.startsWith('/comments') },
    { to: '/complaints', label: 'Complaints', icon: AlertTriangle, count: counts.complaints, active: path.startsWith('/complaints') },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, count: 0, active: path === '/settings' },
  ];
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink-line pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4 max-w-xl mx-auto">
        {tabs.map((t) => (
          <button key={t.to} onClick={() => navigate(t.to)} className={`relative flex flex-col items-center py-2 text-[11px] font-semibold ${t.active ? 'text-beet' : 'text-ink-soft'}`}>
            <t.icon size={22} />
            {t.label}
            {t.count > 0 && <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-beet text-white text-[10px] flex items-center justify-center">{t.count > 99 ? '99+' : t.count}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  const { user, accessToken } = useAuth();
  const logout = useLogout();
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Gate: only staff with chat access get past the login.
  useEffect(() => {
    if (!accessToken) {
      setMe(null);
      setDenied(null);
      return;
    }
    api.get<Me>('/chatbot/staff/me').then(
      (m) => {
        setMe(m);
        setDenied(null);
        void resync();
      },
      (e: Error) => setDenied(e instanceof ApiError && e.status === 403 ? 'Your account is not set up for chats yet. Ask the owner to switch on “Can handle chats” on your staff profile.' : e.message),
    );
  }, [accessToken]);

  useLive(me?.branchId, () => setRefreshKey((k) => k + 1));
  // Coming back to the app: refresh at once instead of waiting for the timer.
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && setRefreshKey((k) => k + 1);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const counts = useCounts(!!me, refreshKey);
  const lastAlarm = useRef<string | null>(null);
  useEffect(() => {
    // Chime only for something new while the app is open (closed apps get a notification instead).
    if (lastAlarm.current !== null && counts.alarm && counts.alarm !== lastAlarm.current) {
      const before = new Set(lastAlarm.current.split('|'));
      if (counts.alarm.split('|').some((k) => k && !before.has(k))) chime();
    }
    lastAlarm.current = counts.alarm;
  }, [counts.alarm]);

  if (!user || !accessToken) return <Login />;
  if (denied) {
    return (
      <div className="min-h-[100dvh] bg-cream flex flex-col items-center justify-center p-6 text-center gap-4">
        <img src="/icon-192.png" alt="" className="w-16 h-16 rounded-2xl" />
        <p className="text-ink">{denied}</p>
        <Button kind="ghost" onClick={() => void logout()}>Sign out</Button>
      </div>
    );
  }
  if (!me) return <div className="min-h-[100dvh] bg-cream flex items-center justify-center text-ink-soft">Loading…</div>;

  const chat = /^\/chat\/([^/]+)$/.exec(path);
  const comment = /^\/comments\/([^/]+)$/.exec(path);
  const complaint = /^\/complaints\/([^/]+)$/.exec(path);

  if (chat) return <ChatScreen id={chat[1]} refreshKey={refreshKey} />;

  let screen: JSX.Element;
  if (comment) screen = <CommentScreen id={comment[1]} refreshKey={refreshKey} />;
  else if (complaint) screen = <ComplaintScreen id={complaint[1]} refreshKey={refreshKey} />;
  else if (path === '/comments') screen = <CommentsList refreshKey={refreshKey} />;
  else if (path === '/complaints') screen = <ComplaintsList refreshKey={refreshKey} />;
  else if (path === '/settings') screen = <Settings name={me.name} branch={me.branchName} onLogout={() => void logout()} />;
  else screen = <ChatsList refreshKey={refreshKey} />;

  return (
    <div className="min-h-[100dvh] bg-cream pb-20">
      {screen}
      <TabBar path={path} counts={counts} />
    </div>
  );
}
