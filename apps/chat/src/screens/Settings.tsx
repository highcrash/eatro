import { Bell, BellOff, LogOut, Share, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pushState, turnOff, turnOn, type PushState } from '../lib/push';
import { Button, ErrorLine, Header } from '../ui';

const STATE_TEXT: Record<PushState, string> = {
  on: 'Notifications are on for this phone.',
  off: 'Notifications are off for this phone.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.',
  unsupported: 'This browser cannot show notifications. Use Chrome on Android, or Safari on iPhone after adding the app to your Home Screen.',
  'needs-install': 'On iPhone, notifications only work from the Home Screen app. Tap the Share button, then “Add to Home Screen”, and open EATRO Chat from there.',
};

export default function Settings({ name, branch, onLogout }: { name: string; branch: string; onLogout: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const run = async (fn: () => Promise<PushState | void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await fn();
      if (next) setState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    run(async () => {
      const r = await api.post<{ devices: number; sent: number }>('/chatbot/push/test');
      setNote(r.sent > 0 ? 'Test sent. It should appear in a few seconds.' : 'No phone of yours is set up for notifications yet.');
    });

  return (
    <>
      <Header title="Settings" subtitle={`${name} · ${branch}`} />
      <ErrorLine error={error} />
      <div className="p-3 space-y-3">
        <section className="rounded-xl bg-white border border-ink-line p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            {state === 'on' ? <Bell size={18} className="text-beet" /> : <BellOff size={18} className="text-ink-soft" />} Notifications
          </div>
          <p className="text-sm text-ink-soft">You get a notification when a customer needs a person: the bot handed the chat over, a complaint came in, or a reply is waiting for your approval.</p>
          {state && <p className="text-sm">{STATE_TEXT[state]}</p>}
          {state === 'needs-install' && (
            <div className="flex items-center gap-2 text-xs text-ink-soft">
              <Share size={14} /> Share → Add to Home Screen
            </div>
          )}
          {state === 'off' && (
            <Button disabled={busy} onClick={() => void run(turnOn)} className="w-full">
              Turn on notifications
            </Button>
          )}
          {state === 'on' && (
            <div className="flex gap-2">
              <Button kind="ghost" disabled={busy} onClick={() => void test()} className="flex-1">
                Send test
              </Button>
              <Button kind="ghost" disabled={busy} onClick={() => void run(turnOff)} className="flex-1">
                Turn off
              </Button>
            </div>
          )}
          {note && <p className="text-sm text-[#1FA855]">{note}</p>}
        </section>

        <section className="rounded-xl bg-white border border-ink-line p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <Smartphone size={18} className="text-beet" /> Add to your Home Screen
          </div>
          <p className="text-sm text-ink-soft">Android (Chrome): menu ⋮ → “Add to Home screen” or “Install app”.</p>
          <p className="text-sm text-ink-soft">iPhone (Safari): Share → “Add to Home Screen”.</p>
        </section>

        <Button kind="danger" onClick={onLogout} className="w-full flex items-center justify-center gap-2">
          <LogOut size={16} /> Sign out
        </Button>
      </div>
    </>
  );
}

export function useLogout() {
  const clear = useAuth((s) => s.clear);
  return async () => {
    await turnOff().catch(() => undefined);
    clear();
  };
}
