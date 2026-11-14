import { api } from './api';

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function iosNeedsInstall(): boolean {
  return isIos() && !isInstalled();
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // The worker is only built for production; in local dev there is none.
  if (import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (iosNeedsInstall()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function keyBytes(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/** Must be called from a tap: phones only allow the permission prompt then. */
export async function turnOn(): Promise<PushState> {
  if (!supported()) return iosNeedsInstall() ? 'needs-install' : 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerWorker());
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/chatbot/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.post('/chatbot/push/subscribe', sub.toJSON());
  return 'on';
}

export async function turnOff(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post('/chatbot/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/** Keeps the server's copy fresh after a login or a browser key change. */
export async function resync(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api.post('/chatbot/push/subscribe', sub.toJSON()).catch(() => undefined);
}
