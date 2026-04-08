import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';

import { useNotifications, type PosNotification } from '../hooks/useNotifications';
import { useNotificationsStore } from '../store/notifications.store';

const TYPE_STYLES: Record<PosNotification['type'], { bg: string; text: string; emoji: string }> = {
  qr:    { bg: 'bg-theme-warn/15', text: 'text-theme-warn',   emoji: '📲' },
  items: { bg: 'bg-theme-danger/15', text: 'text-theme-danger', emoji: '🔔' },
  bill:  { bg: 'bg-theme-info/15', text: 'text-theme-info',   emoji: '💰' },
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const { unseen } = useNotifications();
  const markSeen = useNotificationsStore((s) => s.markSeen);
  const markAllSeen = useNotificationsStore((s) => s.markAllSeen);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleClickNotification = (n: PosNotification) => {
    markSeen(n.key);
    setOpen(false);
    if (n.tableId) {
      navigate(`/order/${n.tableId}`, { state: { tableNumber: n.tableNumber } });
    } else {
      navigate(`/order?orderId=${n.orderId}`);
    }
  };

  return (
    <div className="fixed top-3 right-4 z-40" ref={popoverRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative w-11 h-11 rounded-full bg-theme-surface border border-theme-border shadow-md flex items-center justify-center transition-colors ${unseen.length > 0 ? 'text-theme-accent hover:bg-theme-accent-soft' : 'text-theme-text-muted hover:text-theme-text'}`}
        title={`${unseen.length} notification${unseen.length === 1 ? '' : 's'}`}
      >
        <Bell size={18} className={unseen.length > 0 ? 'animate-pulse' : ''} />
        {unseen.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-theme-danger text-white text-[10px] font-bold flex items-center justify-center">
            {unseen.length > 99 ? '99+' : unseen.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-12 right-0 w-[360px] max-h-[70vh] bg-theme-surface rounded-theme border border-theme-border shadow-2xl overflow-hidden flex flex-col">
          <header className="px-4 py-3 border-b border-theme-border flex items-center justify-between shrink-0">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Notifications</p>
              <p className="text-sm font-bold text-theme-text">
                {unseen.length === 0 ? 'All caught up' : `${unseen.length} unread`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unseen.length > 0 && (
                <button
                  onClick={() => markAllSeen(unseen.map((n) => n.key))}
                  className="text-[10px] font-semibold text-theme-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {unseen.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={28} className="text-theme-text-muted/60 mx-auto mb-2" />
                <p className="text-xs text-theme-text-muted">No new notifications</p>
              </div>
            ) : (
              unseen.map((n) => {
                const tone = TYPE_STYLES[n.type];
                return (
                  <button
                    key={n.key}
                    onClick={() => handleClickNotification(n)}
                    className="w-full text-left px-4 py-3 border-b border-theme-border hover:bg-theme-bg transition-colors flex items-start gap-3"
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tone.bg}`}>
                      <span className="text-base">{tone.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${tone.text}`}>{n.title}</p>
                      <p className="text-[11px] text-theme-text-muted truncate">{n.body}</p>
                      <p className="text-[10px] text-theme-text-muted/70 mt-0.5">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
