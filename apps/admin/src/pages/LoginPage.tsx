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
      if (res.user.role !== 'OWNER' && res.user.role !== 'MANAGER') {
        setError('Owner or Manager credentials required');
        return;
      }
      setAuth(res.user, res.accessToken, res.refreshToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-[#D62B2B] flex items-center justify-center">
            <span className="font-display text-white text-lg tracking-wider">R</span>
          </div>
          <span className="font-display text-white text-2xl tracking-widest">ADMIN</span>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[#999] text-xs font-body font-medium tracking-widest uppercase">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
            />
          </div>
          {error && <p className="text-[#D62B2B] text-xs font-body">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body font-medium text-sm py-3 transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
