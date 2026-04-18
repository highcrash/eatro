import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { Button, Card, Input, Label } from '../components/ui';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ok, setOk] = useState(false);

  const change = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>('/admin/password', input),
    onSuccess: () => {
      setOk(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // Sessions stay valid until expiry — no force-logout.
      setTimeout(() => setOk(false), 3000);
    },
  });

  const mismatch = newPassword !== '' && confirmPassword !== '' && newPassword !== confirmPassword;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-4xl tracking-widest text-black-text mb-6">SETTINGS</h1>

      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl tracking-widest mb-2">ACCOUNT</h2>
        <p className="text-sm font-body text-black-text/60 mb-1">Signed in as</p>
        <p className="font-body text-black-text">{user?.email}</p>
        <p className="text-[11px] uppercase tracking-widest font-body text-black-text/50 mt-2">Role: {user?.role}</p>
      </Card>

      <Card className="p-6 mb-6">
        <h2 className="font-display text-xl tracking-widest mb-4">CHANGE PASSWORD</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mismatch) return;
            change.mutate({ currentPassword, newPassword });
          }}
          className="space-y-3 max-w-sm"
        >
          <div>
            <Label>Current password</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <Label>New password (min 10 chars)</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={10} />
          </div>
          <div>
            <Label>Confirm new password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
          </div>

          {mismatch && <p className="text-sm text-red font-body">Passwords don't match</p>}
          {change.isError && <p className="text-sm text-red font-body">{(change.error as Error).message}</p>}
          {ok && <p className="text-sm text-green font-body">Password changed.</p>}

          <Button type="submit" disabled={change.isPending || mismatch || !currentPassword || !newPassword || !confirmPassword}>
            {change.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="font-display text-xl tracking-widest mb-2">SESSION</h2>
        <p className="text-sm font-body text-black-text/60 mb-3">
          Signing out just discards your token locally. Session expires server-side at the JWT's exp.
        </p>
        <Button variant="outline" onClick={clearAuth}>Sign out</Button>
      </Card>
    </div>
  );
}
