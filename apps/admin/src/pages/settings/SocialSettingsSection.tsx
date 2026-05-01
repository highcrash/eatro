import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface SocialSettings {
  fbAutopostEnabled: boolean;
  fbPageId: string | null;
  fbPageName: string | null;
  fbConnectedAt: string | null;
  fbDefaultPostTime: string;
  fbHasToken: boolean;
}

/**
 * Marketing tab. One sub-card:
 *   1. Facebook auto-post — connect a page (token + page id), enable
 *      toggle, default post time. When connected the form swaps to a
 *      "Connected as <name>" card with Disconnect.
 *
 * Token is write-only — `fbHasToken` is the only flag the GET returns,
 * so the UI just renders "(saved)" placeholder on the token input.
 */
export default function SocialSettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery<SocialSettings>({
    queryKey: ['social-settings'],
    queryFn: () => api.get('/social/settings'),
  });

  const [pageId, setPageId] = useState('');
  const [token, setToken] = useState('');
  const [defaultTime, setDefaultTime] = useState('11:00');
  const [loaded, setLoaded] = useState(false);
  const [connectError, setConnectError] = useState<string>('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      setDefaultTime(settings.fbDefaultPostTime);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const connectMut = useMutation({
    mutationFn: (dto: { pageId: string; pageAccessToken: string }) =>
      api.post<{ pageId: string; pageName: string }>('/social/connect', dto),
    onSuccess: () => {
      setPageId(''); setToken(''); setConnectError('');
      void qc.invalidateQueries({ queryKey: ['social-settings'] });
    },
    onError: (err: Error) => setConnectError(err.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.post('/social/disconnect', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['social-settings'] }),
  });

  const enabledMut = useMutation({
    mutationFn: (enabled: boolean) => api.post('/social/settings/enabled', { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['social-settings'] }),
  });

  const timeMut = useMutation({
    mutationFn: (time: string) => api.post('/social/settings/default-post-time', { time }),
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      void qc.invalidateQueries({ queryKey: ['social-settings'] });
    },
  });

  if (!settings) {
    return <p className="text-sm text-[#666] font-body">Loading…</p>;
  }

  const isConnected = settings.fbHasToken && !!settings.fbPageId;

  return (
    <div className="space-y-6">
      <div className="bg-[#161616] border border-[#2A2A2A] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg text-white tracking-widest uppercase">Facebook Auto-Post</h3>
            <p className="text-xs text-[#999] font-body mt-1">
              Every new menu discount auto-generates a designed image + caption and queues a Facebook post on the connected page.
            </p>
          </div>
          {isConnected && (
            <label className="flex items-center gap-2 text-xs font-body text-[#DDD9D3]">
              <input
                type="checkbox"
                checked={settings.fbAutopostEnabled}
                onChange={(e) => enabledMut.mutate(e.target.checked)}
                disabled={!isOwner || enabledMut.isPending}
                className="w-4 h-4 accent-[#D62B2B]"
              />
              Auto-post enabled
            </label>
          )}
        </div>

        {isConnected ? (
          <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-[#999] font-body uppercase tracking-widest">Connected as</p>
              <p className="font-body font-medium text-sm text-white">{settings.fbPageName ?? settings.fbPageId}</p>
              <p className="text-[10px] text-[#666] font-body mt-1">Page ID: <span className="font-mono">{settings.fbPageId}</span></p>
              {settings.fbConnectedAt && (
                <p className="text-[10px] text-[#666] font-body">Since: {new Date(settings.fbConnectedAt).toLocaleString()}</p>
              )}
            </div>
            {isOwner && (
              <button
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
                className="text-xs font-body uppercase tracking-widest text-[#D62B2B] hover:text-white hover:bg-[#D62B2B] border border-[#D62B2B] px-3 py-2 transition-colors disabled:opacity-40"
              >
                {disconnectMut.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#888] font-body">
              Paste your Facebook Page ID and a long-lived Page Access Token (Graph API Explorer →
              Page Token). Anyone managing the page can generate one — the connection works without our app having a published Facebook app.
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Page ID</label>
                <input
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="e.g. 1234567890"
                  disabled={!isOwner}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Page Access Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EAAB…"
                  disabled={!isOwner}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
              {connectError && (
                <p className="text-xs text-[#D62B2B] font-body">{connectError}</p>
              )}
              <button
                onClick={() => connectMut.mutate({ pageId: pageId.trim(), pageAccessToken: token.trim() })}
                disabled={!isOwner || !pageId.trim() || !token.trim() || connectMut.isPending}
                className="bg-[#D62B2B] hover:bg-[#C02020] text-white text-xs font-body font-medium tracking-widest uppercase px-4 py-2 transition-colors disabled:opacity-40 self-start"
              >
                {connectMut.isPending ? 'Connecting…' : 'Connect Page'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] p-5 space-y-4">
        <h3 className="font-display text-lg text-white tracking-widest uppercase">Default Post Time</h3>
        <p className="text-xs text-[#999] font-body">
          When a discount's start date falls at midnight (most common), we roll the post forward to this time so customers see it during browsing hours instead of overnight.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="time"
            value={defaultTime}
            onChange={(e) => setDefaultTime(e.target.value)}
            disabled={!isOwner}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
          />
          <button
            onClick={() => timeMut.mutate(defaultTime)}
            disabled={!isOwner || timeMut.isPending}
            className="bg-[#161616] hover:bg-[#1F1F1F] border border-[#2A2A2A] text-white text-xs font-body uppercase tracking-widest px-4 py-2 transition-colors disabled:opacity-40"
          >
            {timeMut.isPending ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
