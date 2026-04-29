import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface TipsoiSettings {
  tipsoiEnabled: boolean;
  tipsoiApiUrl: string;
  /** Server never echoes the token; this is just a presence flag so
   *  the UI can render "(saved)" placeholder on the token input. */
  tipsoiApiTokenSet: boolean;
  tipsoiLastSyncAt: string | null;
  tipsoiLastSyncStatus: string | null;
  attendanceShiftStart: string;
  attendanceShiftEnd: string;
  attendanceLateGraceMinutes: number;
  attendanceHalfDayAfterMinutes: number;
}

interface TipsoiSyncResult {
  branchId: string;
  range: { from: string; to: string };
  scanned: number;
  created: number;
  updated: number;
  skippedByOverride: number;
  errors: string[];
}

/**
 * HR / Attendance settings tab. Two sub-cards:
 *   1. Tipsoi gateway — enable toggle + API URL + token (write-only) +
 *      "Test connection" + "Sync now (last 7 days)" + last-sync status.
 *   2. Default attendance rules — shift start/end + late grace + half-day
 *      cutoff. Per-staff overrides on the Staff page take precedence.
 */
export default function TipsoiSettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery<TipsoiSettings>({
    queryKey: ['tipsoi-settings'],
    queryFn: () => api.get('/tipsoi/settings'),
  });

  // Token is write-only (never round-tripped through the GET).
  // Empty input + tipsoiApiTokenSet=true → "(saved — leave blank to keep)".
  const [token, setToken] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [shiftStart, setShiftStart] = useState('10:00');
  const [shiftEnd, setShiftEnd] = useState('22:00');
  const [graceMin, setGraceMin] = useState(30);
  const [halfDayMin, setHalfDayMin] = useState(180);
  const [loaded, setLoaded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncResult, setSyncResult] = useState<TipsoiSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string>('');

  useEffect(() => {
    if (settings && !loaded) {
      setApiUrl(settings.tipsoiApiUrl);
      setShiftStart(settings.attendanceShiftStart);
      setShiftEnd(settings.attendanceShiftEnd);
      setGraceMin(settings.attendanceLateGraceMinutes);
      setHalfDayMin(settings.attendanceHalfDayAfterMinutes);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const updateMut = useMutation({
    mutationFn: (dto: Partial<{
      tipsoiEnabled: boolean;
      tipsoiApiToken: string | null;
      tipsoiApiUrl: string;
      attendanceShiftStart: string;
      attendanceShiftEnd: string;
      attendanceLateGraceMinutes: number;
      attendanceHalfDayAfterMinutes: number;
    }>) => api.patch('/tipsoi/settings', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tipsoi-settings'] }),
  });

  const testMut = useMutation({
    mutationFn: (dto: { apiUrl: string; apiToken: string }) =>
      api.post<{ ok: boolean; message: string; peopleCount?: number }>('/tipsoi/test-token', dto),
    onSuccess: (res) => setTestResult(res),
    onError: (err: Error) => setTestResult({ ok: false, message: err.message }),
  });

  const syncMut = useMutation({
    mutationFn: () => api.post<TipsoiSyncResult>('/tipsoi/sync', {}),
    onSuccess: (res) => {
      setSyncResult(res);
      setSyncError('');
      void qc.invalidateQueries({ queryKey: ['tipsoi-settings'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (err: Error) => { setSyncError(err.message); setSyncResult(null); },
  });

  const saveGateway = () => {
    const dto: Record<string, unknown> = { tipsoiApiUrl: apiUrl };
    // Empty token = leave existing alone. Don't send a blank string —
    // the server treats that as "clear the token". Use the explicit
    // "Clear token" button below for that.
    if (token.trim()) dto.tipsoiApiToken = token.trim();
    updateMut.mutate(dto, {
      onSuccess: () => {
        setSavedFlash(true);
        setToken(''); // input cleared on save so we don't echo the secret back
        setTimeout(() => setSavedFlash(false), 2500);
      },
    });
  };

  if (isLoading || !settings) return null;

  return (
    <div className="mt-8 space-y-4">
      <div className="mb-2">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">HR / Attendance</p>
        <h2 className="font-display text-2xl text-white tracking-wide">TIPSOI ATTENDANCE</h2>
        <p className="text-[#666] font-body text-xs mt-1">
          Pull biometric clock-in / clock-out events from your Tipsoi devices
          (api-inovace360.com) and convert them into Attendance rows automatically.
          Manual marks on the Attendance page always win over the next sync.
        </p>
      </div>

      {/* Gateway card */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Gateway</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-body text-[#999]">{settings.tipsoiEnabled ? 'Enabled' : 'Disabled'}</span>
            <input type="checkbox" checked={settings.tipsoiEnabled} disabled={!isOwner}
              onChange={(e) => updateMut.mutate({ tipsoiEnabled: e.target.checked })}
              className="accent-[#D62B2B] w-4 h-4" />
          </label>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">API URL</label>
            <input type="url" value={apiUrl} disabled={!isOwner}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api-inovace360.com"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">
              API Token{settings.tipsoiApiTokenSet && <span className="text-[#666] ml-2">(saved — leave blank to keep)</span>}
            </label>
            <input type="password" value={token} disabled={!isOwner}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.tipsoiApiTokenSet ? '••••••••••••••••' : 'paste token here'}
              autoComplete="off"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body font-mono outline-none focus:border-[#D62B2B]" />
          </div>
          {isOwner && (
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={saveGateway} disabled={updateMut.isPending}
                className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-6 py-2.5 font-body text-sm transition-colors disabled:opacity-40">
                {updateMut.isPending ? 'Saving…' : 'Save Gateway'}
              </button>
              <button
                onClick={() => { setTestResult(null); testMut.mutate({ apiUrl, apiToken: token.trim() }); }}
                disabled={(!token.trim() && !settings.tipsoiApiTokenSet) || testMut.isPending}
                className="bg-[#2A2A2A] hover:bg-[#333] text-white px-4 py-2.5 font-body text-sm transition-colors disabled:opacity-40"
                title={settings.tipsoiApiTokenSet && !token.trim() ? 'Re-enter the token to test it; saved tokens are write-only.' : ''}
              >
                {testMut.isPending ? 'Testing…' : 'Test Connection'}
              </button>
              {settings.tipsoiApiTokenSet && (
                <button
                  onClick={() => updateMut.mutate({ tipsoiApiToken: null })}
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
              {testResult.message}
            </p>
          )}
        </div>
      </div>

      {/* Sync + status card */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Sync</p>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs font-body">
            <div>
              <p className="text-[#666]">Last sync</p>
              <p className="text-white">
                {settings.tipsoiLastSyncAt
                  ? new Date(settings.tipsoiLastSyncAt).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <p className="text-[#666]">Status</p>
              <p className={settings.tipsoiLastSyncStatus?.startsWith('ERROR') ? 'text-[#F03535]' : 'text-green-500'}>
                {settings.tipsoiLastSyncStatus ?? '—'}
              </p>
            </div>
          </div>
          {isOwner && (
            <button
              onClick={() => { setSyncResult(null); setSyncError(''); syncMut.mutate(); }}
              disabled={!settings.tipsoiEnabled || !settings.tipsoiApiTokenSet || syncMut.isPending}
              className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-6 py-2.5 font-body text-sm transition-colors disabled:opacity-40"
            >
              {syncMut.isPending ? 'Syncing…' : 'Sync now (last 7 days)'}
            </button>
          )}
          {syncError && <p className="text-xs font-body text-[#F03535]">{syncError}</p>}
          {syncResult && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-xs font-body space-y-1">
              <p className="text-[#999]">Scanned <span className="text-white">{syncResult.scanned}</span> · Created <span className="text-green-500">{syncResult.created}</span> · Updated <span className="text-[#FFA726]">{syncResult.updated}</span> · Skipped (override) <span className="text-[#666]">{syncResult.skippedByOverride}</span></p>
              {syncResult.errors.length > 0 && (
                <div className="text-[#F03535] mt-1">
                  {syncResult.errors.map((e, i) => <p key={i}>• {e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Default attendance rules */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Default Attendance Rules</p>
          <p className="text-[#666] font-body text-[10px] mt-0.5">
            Branch defaults applied to every staff member without their own per-staff override on the Staff page.
          </p>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">Shift start (24h)</label>
            <input type="time" value={shiftStart} disabled={!isOwner}
              onChange={(e) => setShiftStart(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">Shift end (24h)</label>
            <input type="time" value={shiftEnd} disabled={!isOwner}
              onChange={(e) => setShiftEnd(e.target.value)}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">Late grace (minutes)</label>
            <input type="number" min={0} max={240} value={graceMin} disabled={!isOwner}
              onChange={(e) => setGraceMin(parseInt(e.target.value || '0', 10))}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
            <p className="text-[10px] text-[#555] mt-1">Clock-in within this window after shift start = PRESENT.</p>
          </div>
          <div>
            <label className="text-xs text-[#999] font-body block mb-1">Half-day cutoff (minutes)</label>
            <input type="number" min={0} max={720} value={halfDayMin} disabled={!isOwner}
              onChange={(e) => setHalfDayMin(parseInt(e.target.value || '0', 10))}
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm text-white font-body outline-none focus:border-[#D62B2B]" />
            <p className="text-[10px] text-[#555] mt-1">Clock-in beyond this many minutes after shift start = HALF_DAY.</p>
          </div>
          {isOwner && (
            <div className="col-span-2">
              <button
                onClick={() => updateMut.mutate({
                  attendanceShiftStart: shiftStart,
                  attendanceShiftEnd: shiftEnd,
                  attendanceLateGraceMinutes: graceMin,
                  attendanceHalfDayAfterMinutes: halfDayMin,
                })}
                disabled={updateMut.isPending}
                className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-6 py-2.5 font-body text-sm transition-colors disabled:opacity-40"
              >
                {updateMut.isPending ? 'Saving…' : 'Save Rules'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
