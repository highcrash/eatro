import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';

import { api } from '../lib/api';
import { useAuthStore, decodeJwt } from '../store/auth.store';
import { Button, Input, Label, Card } from '../components/ui';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setAuth = useAuthStore((s) => s.setAuth);

  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<{ token: string; expiresIn: string }>('/admin/login', input),
    onSuccess: ({ token }) => {
      const user = decodeJwt(token);
      if (user) setAuth(token, user);
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-white-warm">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-red flex items-center justify-center">
            <KeyRound size={20} className="text-white" />
          </div>
          <div>
            <p className="font-display text-2xl tracking-widest text-black-text leading-none">LICENSE</p>
            <p className="text-[10px] tracking-widest font-body text-black-text/50 uppercase">Admin</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate({ email, password });
          }}
          className="space-y-4"
        >
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {login.isError && (
            <p className="text-sm text-red font-body">{(login.error as Error).message}</p>
          )}

          <Button type="submit" disabled={login.isPending || !email || !password} className="w-full justify-center">
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
