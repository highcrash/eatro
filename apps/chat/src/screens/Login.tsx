import { useState } from 'react';
import type { LoginResponse } from '@restora/types';

import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', { email: email.trim(), password });
      setAuth(res.user, res.accessToken, res.refreshToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-cream flex flex-col items-center justify-center px-6 pt-[env(safe-area-inset-top)]">
      <img src="/icon-192.png" alt="" className="w-20 h-20 rounded-2xl shadow mb-4" />
      <h1 className="text-2xl font-bold text-beet tracking-wide">EATRO</h1>
      <p className="text-ink-soft text-sm mb-8">Staff Chat</p>
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-3">
        <input
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-xl border border-ink-line bg-white px-4 py-3 text-base focus:outline-none focus:border-beet"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl border border-ink-line bg-white px-4 py-3 text-base focus:outline-none focus:border-beet"
        />
        {error && <p className="text-sm text-beet-dark">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-beet text-white font-semibold py-3 active:bg-beet-dark disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-xs text-ink-soft mt-8 text-center max-w-xs">Use your EATRO staff email and password. Ask the owner to switch on “Can handle chats” for you.</p>
    </div>
  );
}
