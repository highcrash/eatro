import { useState } from 'react';

import type { LoginResponse } from '@restora/types';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';

export default function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', { email, password });
      setAuth(res.user, res.accessToken, res.refreshToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg flex items-center justify-center p-4">
      <div className="bg-theme-surface rounded-theme border border-theme-border shadow-xl p-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-14 h-14 bg-theme-accent rounded-theme flex items-center justify-center">
            <span className="text-white font-extrabold text-2xl">R</span>
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-center text-theme-text mb-1">Restro POS</h1>
        <p className="text-theme-text-muted text-sm text-center mb-8">Sign in to start your shift</p>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="block text-xs font-semibold text-theme-text-muted uppercase tracking-wider mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-theme-bg rounded-theme px-4 py-3 text-sm text-theme-text mb-4 focus:outline-none focus:ring-2 focus:ring-theme-accent/30 border border-transparent focus:border-theme-accent/40"
          />

          <label className="block text-xs font-semibold text-theme-text-muted uppercase tracking-wider mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-theme-bg rounded-theme px-4 py-3 text-sm text-theme-text mb-2 focus:outline-none focus:ring-2 focus:ring-theme-accent/30 border border-transparent focus:border-theme-accent/40"
          />

          <p className="text-xs text-theme-danger mb-4 min-h-[16px]">{error || '\u00a0'}</p>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-theme-accent hover:opacity-90 text-white font-bold py-3.5 rounded-theme transition-opacity disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-theme-text-muted mt-6">Your Restaurant POS · Sunrise Theme</p>
      </div>
    </div>
  );
}
