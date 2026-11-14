import { useEffect, useState } from 'react';

/** Tiny path router: the app has a handful of screens and deep links from notifications. */
export function navigate(path: string, replace = false) {
  if (path === window.location.pathname) return;
  // `inApp` marks pages reached from inside the app, so Back can return to them.
  if (replace) window.history.replaceState(window.history.state, '', path);
  else window.history.pushState({ inApp: true }, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    // A tapped notification while the app is already open.
    const fromWorker = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type === 'open' && data.url) navigate(new URL(data.url).pathname);
    };
    navigator.serviceWorker?.addEventListener('message', fromWorker);
    return () => {
      window.removeEventListener('popstate', on);
      navigator.serviceWorker?.removeEventListener('message', fromWorker);
    };
  }, []);
  return path;
}

/** Back to the previous screen, or to `fallback` when the app was opened on this page (e.g. from a notification). */
export function back(fallback = '/') {
  if ((window.history.state as { inApp?: boolean } | null)?.inApp) window.history.back();
  else navigate(fallback, true);
}
