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

/**
 * Shown at the top of the Chats screen until notifications are on, so staff
 * don't have to find the Settings tab. Says exactly what this phone needs.
 */
export function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (!state || state === 'on') return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await turnOn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-3 mt-3 rounded-xl border-2 border-beet bg-white p-3 space-y-2">
      <div className="flex items-center gap-2 font-semibold text-beet">
        <Bell size={18} /> Get notified when a customer needs you
      </div>
      {state === 'off' && (
        <>
          <p className="text-sm text-ink-soft">Tap the button, then tap “Allow”.</p>
          <Button disabled={busy} onClick={() => void enable()} className="w-full">
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </Button>
        </>
      )}
      {state === 'needs-install' && (
        <ol className="text-sm text-ink list-decimal pl-5 space-y-1">
          <li>Tap the Share button <Share size={14} className="inline -mt-0.5" /> at the bottom of Safari.</li>
          <li>Choose “Add to Home Screen”, then “Add”.</li>
          <li>Close Safari and open <b>EATRO Chat</b> from your Home Screen. This button will appear there.</li>
        </ol>
      )}
      {state === 'blocked' && (
        <p className="text-sm text-ink">
          Notifications are blocked for this app. Android: tap the lock or ⓘ next to the address (or long-press the app icon → App info) → Notifications → Allow. iPhone: Settings → Notifications → EATRO Chat → Allow. Then reopen the app.
        </p>
      )}
      {state === 'unsupported' && <p className="text-sm text-ink">This browser can't show notifications. On Android use Chrome; on iPhone use Safari and add the app to your Home Screen.</p>}
      {error && <p className="text-sm text-beet-dark">{error}</p>}
    </div>
  );
}

export function useLogout() {
  const clear = useAuth((s) => s.clear);
  return async () => {
    await turnOff().catch(() => undefined);
    clear();
  };
}
