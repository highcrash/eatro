import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, XCircle } from 'lucide-react';

import { api } from '../../lib/api';
import { CARD, fmtTime, friendly, GHOST, HINT, INPUT, LABEL, PRIMARY } from './shared';

interface HealthItem { key: string; label: string; ok: boolean; detail: string | null }
interface ConnectStatus {
  appId: string | null;
  appSecretSet: boolean;
  appSecretUnreadable: boolean;
  verifyToken: string;
  webhookUrl: string;
  whatsappWebhookUrl: string;
  redirectUri: string;
  privacyUrl: string;
  dataDeletionUrl: string;
  page: { id: string; name: string | null; tokenSet: boolean } | null;
  instagram: { id: string; username: string | null } | null;
  grantedScopes: string[];
  missingScopes: string[];
  appSubscribedAt: string | null;
  pageSubscribedAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  health: HealthItem[];
  healthCheckedAt: string | null;
  pendingPages: { id: string; name: string; igUsername: string | null }[];
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className={`flex-1 ${INPUT} font-mono text-xs`} onFocus={(e) => e.target.select()} />
        <button onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className={`${GHOST} !px-3`} title="Copy">
          {copied ? 'Copied' : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function ConnectTab({ result }: { result: { fb: string | null; msg: string | null } }) {
  const qc = useQueryClient();
  const { data: s } = useQuery<ConnectStatus>({ queryKey: ['chat-connect'], queryFn: () => api.get('/chatbot/connect') });
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const refresh = (data: ConnectStatus) => qc.setQueryData(['chat-connect'], data);
  const saveApp = useMutation({ mutationFn: () => api.put<ConnectStatus>('/chatbot/connect/app', { appId: appId || s?.appId, appSecret: appSecret || undefined }), onSuccess: (d) => { refresh(d); setAppSecret(''); }, onSettled: () => void qc.invalidateQueries({ queryKey: ['chat-connect'] }) });
  const login = useMutation({ mutationFn: () => api.post<{ url: string }>('/chatbot/connect/facebook/start', {}), onSuccess: (d) => { window.location.href = d.url; } });
  const pick = useMutation({ mutationFn: (pageId: string) => api.post<ConnectStatus>('/chatbot/connect/page', { pageId }), onSuccess: refresh });
  const check = useMutation({ mutationFn: () => api.post<ConnectStatus>('/chatbot/connect/check', {}), onSuccess: refresh });
  if (!s) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
      <div className="space-y-6">
        {result.fb === 'ok' && <p className="text-[#4CAF50] text-sm font-body">Facebook connected. Check the list on the right.</p>}
        {result.fb === 'error' && <p className="text-[#F03535] text-sm font-body">Facebook connection failed: {result.msg}</p>}

        <section className={`${CARD} p-4 space-y-3`}>
          <h2 className="font-display text-xl text-white tracking-wide">1. META APP</h2>
          <p className={HINT}>
            From developers.facebook.com → your app → App settings → Basic. The secret is stored encrypted and never shown again. Saving registers the webhook with Meta, so
            set the app's privacy and data-deletion addresses (below) first.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>App ID</label>
              <input value={appId || s.appId || ''} onChange={(e) => setAppId(e.target.value.trim())} placeholder="1234567890123456" className={`w-full ${INPUT}`} />
            </div>
            <div>
              <label className={LABEL}>App Secret {s.appSecretSet && <span className="text-[#4CAF50] normal-case tracking-normal">(saved)</span>}{s.appSecretUnreadable && <span className="text-[#F03535] normal-case tracking-normal">(unreadable, paste again)</span>}</label>
              <input type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value.trim())} placeholder={s.appSecretSet ? 'Leave empty to keep' : '32 letters and numbers'} className={`w-full ${INPUT}`} />
            </div>
          </div>
          {saveApp.error && <p className="text-[#F03535] text-xs font-body">{friendly(saveApp.error)}</p>}
          <button onClick={() => saveApp.mutate()} disabled={saveApp.isPending || !(appId || s.appId)} className={PRIMARY}>{saveApp.isPending ? 'Saving and registering…' : 'Save app and register webhook'}</button>
        </section>

        <section className={`${CARD} p-4 space-y-3`}>
          <h2 className="font-display text-xl text-white tracking-wide">2. ADDRESSES FOR THE META APP</h2>
          <p className={HINT}>Paste these into the app's settings. The verify token is created here and is not a password.</p>
          <CopyRow label="Valid OAuth redirect URI (Facebook Login for Business → Settings)" value={s.redirectUri} />
          <CopyRow label="Webhook callback URL (Messenger and Instagram)" value={s.webhookUrl} />
          <CopyRow label="Webhook verify token" value={s.verifyToken} />
          <CopyRow label="Privacy policy URL" value={s.privacyUrl} />
          <CopyRow label="User data deletion URL" value={s.dataDeletionUrl} />
        </section>

        <section className={`${CARD} p-4 space-y-3`}>
          <h2 className="font-display text-xl text-white tracking-wide">3. FACEBOOK PAGE AND INSTAGRAM</h2>
          <p className={HINT}>Opens Facebook. Choose the EATRO Page and its Instagram account, and allow every permission it asks for.</p>
          {s.page && <p className="text-white text-sm font-body">Connected: <b>{s.page.name ?? s.page.id}</b>{s.instagram ? <> and Instagram <b>@{s.instagram.username ?? s.instagram.id}</b></> : <span className="text-[#FFA726]"> (no Instagram account linked)</span>}</p>}
          {s.pendingPages.length > 0 && (
            <div className="space-y-2">
              <p className="text-[#FFA726] text-sm font-body">You manage more than one Page. Which one is EATRO?</p>
              {s.pendingPages.map((p) => (
                <button key={p.id} onClick={() => pick.mutate(p.id)} disabled={pick.isPending} className={`${GHOST} w-full text-left`}>
                  {p.name}{p.igUsername ? ` · Instagram @${p.igUsername}` : ''}
                </button>
              ))}
            </div>
          )}
          {(login.error || pick.error) && <p className="text-[#F03535] text-xs font-body">{friendly(login.error ?? pick.error)}</p>}
          <button onClick={() => login.mutate()} disabled={login.isPending || !s.appId || !s.appSecretSet} className={PRIMARY}>{s.page ? 'Reconnect with Facebook' : 'Connect with Facebook'}</button>
          {(!s.appId || !s.appSecretSet) && <p className={HINT}>Save the Meta app first.</p>}
          {s.grantedScopes.length > 0 && s.missingScopes.length > 0 && (
            <p className="text-[#FFA726] text-xs font-body">Not granted yet: {s.missingScopes.join(', ')}. Until Meta approves the app review, these may stay missing; replies then work only for people with a role on the app or Page.</p>
          )}
        </section>
      </div>

      <div className={`${CARD} p-4 space-y-3 h-fit`}>
        <div className="flex items-center">
          <h2 className="font-display text-xl text-white tracking-wide flex-1">HEALTH CHECK</h2>
          <button onClick={() => check.mutate()} disabled={check.isPending} className={`${GHOST} !px-3 !py-1 text-xs`}>{check.isPending ? 'Checking…' : 'Check now'}</button>
        </div>
        {s.health.length === 0 && <p className={HINT}>Not checked yet.</p>}
        {s.health.map((h) => (
          <div key={h.key} className="flex gap-2 items-start">
            {h.ok ? <CheckCircle2 size={16} className="text-[#4CAF50] mt-0.5 shrink-0" /> : <XCircle size={16} className="text-[#F03535] mt-0.5 shrink-0" />}
            <div>
              <p className="text-white text-sm font-body">{h.label}</p>
              {h.detail && <p className={HINT}>{h.detail}</p>}
            </div>
          </div>
        ))}
        {s.lastError && <p className="text-[#F03535] text-xs font-body border-t border-[#222] pt-2">Last problem: {s.lastError}</p>}
        {s.healthCheckedAt && <p className={HINT}>Checked {fmtTime(s.healthCheckedAt)}. Rechecked every hour.</p>}
        {check.error && <p className="text-[#F03535] text-xs font-body">{friendly(check.error)}</p>}
      </div>
    </div>
  );
}
