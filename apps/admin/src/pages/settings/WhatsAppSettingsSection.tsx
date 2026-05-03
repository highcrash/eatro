import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface WhatsAppSettings {
  whatsappEnabled: boolean;
  whatsappPhoneNumberId: string;
  whatsappWabaId: string;
  /** Server never echoes the token; this is just a presence flag so
   *  the UI can render "(saved)" placeholder on the token input. */
  whatsappAccessTokenSet: boolean;
  whatsappPoTemplate: string;
  whatsappPoTemplateLang: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  displayPhoneNumber?: string;
  verifiedName?: string | null;
}

/**
 * WhatsApp Cloud API config block — owners drop in their Meta
 * credentials (Phone Number ID, WABA ID, long-lived access token)
 * and pick which utility template the "Send PO via WhatsApp" button
 * fires. A Test Connection button hits Meta's /{phone-id} endpoint
 * to confirm the creds work before any real send.
 */
export default function WhatsAppSettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery<WhatsAppSettings>({
    queryKey: ['whatsapp-settings'],
    queryFn: () => api.get('/whatsapp/settings'),
  });

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [token, setToken] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateLang, setTemplateLang] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (settings && !loaded) {
      setPhoneNumberId(settings.whatsappPhoneNumberId);
      setWabaId(settings.whatsappWabaId);
      setTemplateName(settings.whatsappPoTemplate);
      setTemplateLang(settings.whatsappPoTemplateLang);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const updateMut = useMutation({
    mutationFn: (dto: Partial<{
      whatsappEnabled: boolean;
      whatsappPhoneNumberId: string;
      whatsappWabaId: string;
      whatsappAccessToken: string | null;
      whatsappPoTemplate: string;
      whatsappPoTemplateLang: string;
    }>) => api.patch('/whatsapp/settings', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['whatsapp-settings'] }),
  });

  const testMut = useMutation({
    mutationFn: (dto: { phoneNumberId?: string; accessToken?: string }) =>
      api.post<{ ok: boolean; displayPhoneNumber: string; verifiedName: string | null }>('/whatsapp/test', dto),
    onSuccess: (res) => setTestResult({
      ok: res.ok,
      displayPhoneNumber: res.displayPhoneNumber,
      verifiedName: res.verifiedName,
      message: `Connected as ${res.verifiedName ? `"${res.verifiedName}" — ` : ''}${res.displayPhoneNumber}`,
    }),
    onError: (err: Error) => setTestResult({ ok: false, message: err.message }),
  });

  const saveAll = () => {
    const dto: Record<string, unknown> = {
      whatsappPhoneNumberId: phoneNumberId.trim(),
      whatsappWabaId: wabaId.trim(),
      whatsappPoTemplate: templateName.trim() || undefined,
      whatsappPoTemplateLang: templateLang.trim() || undefined,
    };
    // Empty token = leave existing alone (matches tipsoi convention).
    // Use the explicit "Clear saved token" button to nuke it.
    if (token.trim()) dto.whatsappAccessToken = token.trim();
    updateMut.mutate(dto, {
      onSuccess: () => {
        setSavedFlash(true);
        setToken('');
        setTimeout(() => setSavedFlash(false), 2500);
      },
    });
  };

  if (isLoading || !settings) return null;

  const credsComplete = !!settings.whatsappPhoneNumberId && !!settings.whatsappAccessTokenSet;

  return (
    <div className="mt-8 space-y-4">
      <div className="mb-2">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Notifications</p>
        <h2 className="font-display text-2xl text-white tracking-wide">WHATSAPP — PURCHASE ORDERS</h2>
        <p className="text-[#666] font-body text-xs mt-1">
          Send Purchase Order PDFs to suppliers via WhatsApp using the Meta Cloud API.
          You'll need a Meta WhatsApp Business app, an approved utility template named
          below (default <span className="font-mono">purchase_order_v1</span>) with a
          Document header and 4 body params (supplier name, PO #, date, total), and the
          long-lived access token from a System User on the WABA.
          <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
             target="_blank" rel="noreferrer"
             className="text-[#D62B2B] hover:text-[#F03535] ml-2 underline">
            Where do I get these?
          </a>
        </p>
      </div>

      {/* Gateway card */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Gateway</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-body text-[#999]">{settings.whatsappEnabled ? 'Enabled' : 'Disabled'}</span>
            <input
              type="checkbox"
              checked={settings.whatsappEnabled}
              disabled={!isOwner || !credsComplete}
              title={!credsComplete ? 'Save Phone Number ID + Access Token first' : ''}
              onChange={(e) => updateMut.mutate({ whatsappEnabled: e.target.checked })}
              className="accent-[#D62B2B] w-4 h-4"
            />
          </label>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">Phone Number ID</label>
            <input
              type="text"
              value={phoneNumberId}
              disabled={!isOwner}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="e.g. 1015342655005467"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]"
            />
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">WhatsApp Business Account ID (WABA)</label>
            <input
              type="text"
              value={wabaId}
              disabled={!isOwner}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="e.g. 3216773228508043"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]"
            />
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">
              Access Token{settings.whatsappAccessTokenSet && <span className="text-[#666] ml-2">(saved — leave blank to keep)</span>}
            </label>
            <input
              type="password"
              value={token}
              disabled={!isOwner}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.whatsappAccessTokenSet ? '••••••••••••••••' : 'paste long-lived token here'}
              autoComplete="off"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#999] font-body block mb-1">PO Template Name</label>
              <input
                type="text"
                value={templateName}
                disabled={!isOwner}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="purchase_order_v1"
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]"
              />
              <p className="text-[10px] text-[#555] mt-1">Must be APPROVED in Meta Business Manager → WhatsApp Manager → Templates.</p>
            </div>
            <div>
              <label className="text-xs text-[#999] font-body block mb-1">Template Language</label>
              <input
                type="text"
                value={templateLang}
                disabled={!isOwner}
                onChange={(e) => setTemplateLang(e.target.value)}
                placeholder="en_US"
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]"
              />
              <p className="text-[10px] text-[#555] mt-1">Match the language code on the approved template (e.g. en_US, en, bn).</p>
            </div>
          </div>

          {isOwner && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={saveAll}
                disabled={updateMut.isPending}
                className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-6 py-2.5 font-body text-sm transition-colors disabled:opacity-40"
              >
                {updateMut.isPending ? 'Saving…' : 'Save WhatsApp Settings'}
              </button>
              <button
                onClick={() => {
                  setTestResult(null);
                  testMut.mutate({
                    phoneNumberId: phoneNumberId.trim() || undefined,
                    accessToken: token.trim() || undefined,
                  });
                }}
                disabled={testMut.isPending || (!phoneNumberId.trim() && !settings.whatsappPhoneNumberId)}
                className="bg-[#2A2A2A] hover:bg-[#333] text-white px-4 py-2.5 font-body text-sm transition-colors disabled:opacity-40"
                title={!token.trim() && settings.whatsappAccessTokenSet ? 'Will use the saved token.' : ''}
              >
                {testMut.isPending ? 'Testing…' : 'Test Connection'}
              </button>
              {settings.whatsappAccessTokenSet && (
                <button
                  onClick={() => updateMut.mutate({ whatsappAccessToken: null })}
                  className="bg-transparent text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors"
                >
                  Clear saved token
                </button>
              )}
              {savedFlash && <span className="text-xs font-body text-green-500">Saved!</span>}
            </div>
          )}
          {testResult && (
            <p className={`text-xs font-body ${testResult.ok ? 'text-green-500' : 'text-[#F03535]'}`}>
              {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
