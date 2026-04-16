import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import type { Branch, UpdateBranchDto, StockUnit } from '@restora/types';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import BrandingSection from './settings/BrandingSection';
import ThemingSection from './settings/ThemingSection';

const UNITS: StockUnit[] = ['KG', 'G', 'L', 'ML', 'PCS', 'DOZEN', 'BOX'];

interface UnitConversion {
  id: string;
  branchId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
}

type TabKey =
  | 'restaurant'
  | 'branding'
  | 'theme'
  | 'kitchen'
  | 'payments'
  | 'reservations'
  | 'notifications'
  | 'units';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'branding', label: 'Branding' },
  { key: 'theme', label: 'Theme' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'payments', label: 'Payments' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'units', label: 'Units' },
];

export default function SettingsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isOwner = user?.role === 'OWNER';

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get<Branch[]>('/branches'),
  });

  // Use the first branch as the primary branch to edit
  const branch = branches[0] ?? null;

  const [form, setForm] = useState<UpdateBranchDto>({});
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'restaurant';
    const stored = window.localStorage.getItem('settings:tab') as TabKey | null;
    return stored && TABS.some((t) => t.key === stored) ? stored : 'restaurant';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('settings:tab', tab);
  }, [tab]);

  useEffect(() => {
    if (branch) {
      setForm({
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        email: branch.email ?? '',
        currency: branch.currency,
        timezone: branch.timezone,
        taxRate: branch.taxRate,
        vatEnabled: (branch as unknown as { vatEnabled?: boolean }).vatEnabled ?? true,
        serviceChargeEnabled: (branch as unknown as { serviceChargeEnabled?: boolean }).serviceChargeEnabled ?? false,
        serviceChargeRate: Number((branch as unknown as { serviceChargeRate?: number }).serviceChargeRate ?? 0),
        stockPricingMethod: (branch as any).stockPricingMethod ?? 'LAST_PURCHASE',
      });
    }
  }, [branch]);

  const updateMutation = useMutation({
    mutationFn: (dto: UpdateBranchDto) => api.patch<Branch>(`/branches/${branch!.id}`, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleChange = (field: keyof UpdateBranchDto, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch || !isOwner) return;
    updateMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[#DDD9D3] font-body text-sm">Loading…</span>
      </div>
    );
  }

  if (!branch) {
    return (
      <div>
        <p className="font-body text-sm text-[#999]">No branch found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Configuration</p>
        <h1 className="font-display text-4xl text-white tracking-wide">SETTINGS</h1>
      </div>

      {!isOwner && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-body text-amber-700">
          You have read-only access. Only the Owner can update branch settings.
        </div>
      )}

      {/* Tab bar — sticky so it stays reachable on long pages */}
      <div className="sticky top-0 z-10 bg-[#0D0D0D] border-b border-[#2A2A2A] -mx-6 px-6 pb-0 overflow-x-auto">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-xs font-body font-medium tracking-widest uppercase border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[#D62B2B] text-white'
                    : 'border-transparent text-[#666] hover:text-white hover:border-[#2A2A2A]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ─── Restaurant tab ──────────────────────────────────────────── */}
      {tab === 'restaurant' && (
      <form onSubmit={handleSubmit}>
        {/* Branch details */}
        <div className="bg-[#161616] border border-[#2A2A2A] mb-6">
          <div className="px-5 py-4 border-b border-[#2A2A2A]">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Branch Details</p>
          </div>
          <div className="p-5 space-y-4">
            <Field label="Branch Name" required>
              <input
                type="text"
                value={form.name ?? ''}
                onChange={(e) => handleChange('name', e.target.value)}
                disabled={!isOwner}
                className="input-base"
                placeholder="e.g. Restora Downtown"
              />
            </Field>
            <Field label="Address" required>
              <input
                type="text"
                value={form.address ?? ''}
                onChange={(e) => handleChange('address', e.target.value)}
                disabled={!isOwner}
                className="input-base"
                placeholder="123 Main St, City"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" required>
                <input
                  type="tel"
                  value={form.phone ?? ''}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  disabled={!isOwner}
                  className="input-base"
                  placeholder="+1 555 000 0000"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  disabled={!isOwner}
                  className="input-base"
                  placeholder="contact@restaurant.com"
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Financials */}
        <div className="bg-[#161616] border border-[#2A2A2A] mb-6">
          <div className="px-5 py-4 border-b border-[#2A2A2A]">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Financials & Locale</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Currency Code">
                <input
                  type="text"
                  value={form.currency ?? ''}
                  onChange={(e) => handleChange('currency', e.target.value.toUpperCase())}
                  disabled={!isOwner}
                  className="input-base"
                  placeholder="USD"
                  maxLength={3}
                />
              </Field>
              <Field label="VAT Rate (%)">
                <input
                  type="number"
                  value={form.taxRate ?? 0}
                  onChange={(e) => handleChange('taxRate', parseFloat(e.target.value) || 0)}
                  disabled={!isOwner || form.vatEnabled === false}
                  className="input-base"
                  placeholder="0"
                  min={0}
                  max={100}
                  step={0.01}
                />
                <label className="flex items-center gap-2 mt-2 text-[11px] text-[#999]">
                  <input
                    type="checkbox"
                    checked={form.vatEnabled ?? true}
                    onChange={(e) => handleChange('vatEnabled', e.target.checked as unknown as number)}
                    disabled={!isOwner}
                  />
                  <span>VAT enabled — when off, no tax is added to new orders regardless of the rate above.</span>
                </label>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Service Charge (%)">
                <input
                  type="number"
                  value={form.serviceChargeRate ?? 0}
                  onChange={(e) => handleChange('serviceChargeRate', parseFloat(e.target.value) || 0)}
                  disabled={!isOwner || form.serviceChargeEnabled === false}
                  className="input-base"
                  placeholder="0"
                  min={0}
                  max={100}
                  step={0.01}
                />
                <label className="flex items-center gap-2 mt-2 text-[11px] text-[#999]">
                  <input
                    type="checkbox"
                    checked={form.serviceChargeEnabled ?? false}
                    onChange={(e) => handleChange('serviceChargeEnabled', e.target.checked as unknown as number)}
                    disabled={!isOwner}
                  />
                  <span>Service charge enabled — when on, the % above is added to every new order before VAT.</span>
                </label>
              </Field>
              <div />
            </div>
            <Field label="Timezone">
              <input
                type="text"
                value={form.timezone ?? ''}
                onChange={(e) => handleChange('timezone', e.target.value)}
                disabled={!isOwner}
                className="input-base"
                placeholder="America/New_York"
              />
            </Field>
          </div>
        </div>

        {/* Stock Pricing */}
        <div className="bg-[#161616] border border-[#2A2A2A] mb-6">
          <div className="px-5 py-4 border-b border-[#2A2A2A]">
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Stock Pricing</p>
          </div>
          <div className="p-5 space-y-4">
            <Field label="Pricing Method on Receive">
              <select
                value={(form as any).stockPricingMethod ?? 'LAST_PURCHASE'}
                onChange={(e) => handleChange('stockPricingMethod' as keyof UpdateBranchDto, e.target.value)}
                disabled={!isOwner}
                className="input-base"
              >
                <option value="LAST_PURCHASE">Last Purchase Price — ingredient cost = latest receive price</option>
                <option value="WEIGHTED_AVERAGE">Weighted Average — blended cost based on existing + new stock</option>
              </select>
            </Field>
            <p className="text-[#666] font-body text-xs">
              This determines how ingredient cost is updated when goods are received.
              "Last Purchase Price" sets the cost to the latest unit price.
              "Weighted Average" calculates: (existing stock x existing cost + new qty x new price) / total stock.
            </p>
          </div>
        </div>

        {isOwner && (
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-8 py-3 font-body font-medium text-sm transition-colors disabled:opacity-40"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && (
              <span className="text-sm font-body text-green-600">Changes saved.</span>
            )}
            {updateMutation.isError && (
              <span className="text-sm font-body text-[#D62B2B]">
                {(updateMutation.error as Error).message}
              </span>
            )}
          </div>
        )}
      </form>
      )}

      {tab === 'branding' && <BrandingSection isOwner={isOwner} />}

      {tab === 'theme' && <ThemingSection isOwner={isOwner} />}

      {tab === 'kitchen' && <KitchenSettingsSection isOwner={isOwner} />}

      {tab === 'payments' && <PaymentMethodsSection />}

      {tab === 'reservations' && <ReservationSettingsSection />}

      {tab === 'notifications' && <SmsSettingsSection isOwner={isOwner} />}

      {tab === 'units' && <UnitConversionSection isOwner={isOwner} />}

      <style>{`
        .input-base {
          width: 100%;
          border: 1px solid #DDD9D3;
          padding: 0.625rem 0.75rem;
          font-family: inherit;
          font-size: 0.875rem;
          color: #111;
          outline: none;
          background: white;
        }
        .input-base:focus {
          border-color: #111;
        }
        .input-base:disabled {
          background: #F2F1EE;
          color: #999;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-1.5">
        {label}{required && <span className="text-[#D62B2B] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── SMS & Notification Settings ─────────────────────────────────────────────

interface SmsSettings {
  smsEnabled: boolean;
  smsApiKey: string | null;
  smsApiUrl: string;
  notifyVoidOtp: boolean;
}

function SmsSettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const [localKey, setLocalKey] = useState('');
  const [localUrl, setLocalUrl] = useState('');
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery<SmsSettings>({
    queryKey: ['sms-settings'],
    queryFn: () => api.get('/settings/sms'),
  });

  // Sync local state when settings load
  useEffect(() => {
    if (settings && !keyLoaded) {
      setLocalKey(settings.smsApiKey ?? '');
      setLocalUrl(settings.smsApiUrl);
      setKeyLoaded(true);
    }
  }, [settings, keyLoaded]);

  const updateMut = useMutation({
    mutationFn: (data: Partial<SmsSettings>) => api.patch('/settings/sms', data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sms-settings'] }),
  });

  const saveKeyUrl = () => {
    updateMut.mutate({ smsApiKey: localKey, smsApiUrl: localUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const testMut = useMutation({
    mutationFn: (phoneNumber: string) => api.post<{ sent: boolean }>('/settings/sms/test', { phoneNumber }),
    onSuccess: (res) => setTestResult((res as any).sent ? 'SMS sent successfully!' : 'SMS sending failed — check API key and URL'),
    onError: (err: Error) => setTestResult(err.message),
  });

  if (isLoading || !settings) return null;

  return (
    <div className="mt-8">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Communications</p>
        <h2 className="font-display text-2xl text-white tracking-wide">SMS GATEWAY</h2>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] mb-4">
        <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Gateway Configuration</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-body text-[#999]">{settings.smsEnabled ? 'Enabled' : 'Disabled'}</span>
            <input type="checkbox" checked={settings.smsEnabled} disabled={!isOwner}
              onChange={(e) => updateMut.mutate({ smsEnabled: e.target.checked })}
              className="accent-[#D62B2B] w-4 h-4" />
          </label>
        </div>
        <div className="p-5 space-y-4">
          <Field label="API Key">
            <input type="text" value={localKey} disabled={!isOwner}
              onChange={(e) => setLocalKey(e.target.value)}
              placeholder="sf_xxxxxxxxxxxxxxxxxxxxxxxx"
              className="input-base font-mono text-xs" />
          </Field>
          <Field label="API URL">
            <input type="url" value={localUrl} disabled={!isOwner}
              onChange={(e) => setLocalUrl(e.target.value)}
              className="input-base" />
          </Field>
          {isOwner && (
            <div className="flex items-center gap-3">
              <button onClick={saveKeyUrl} disabled={updateMut.isPending}
                className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-6 py-2.5 font-body text-sm transition-colors disabled:opacity-40">
                {updateMut.isPending ? 'Saving...' : 'Save Gateway'}
              </button>
              {saved && <span className="text-xs font-body text-green-600">Saved!</span>}
            </div>
          )}

          {/* Test SMS */}
          {isOwner && settings.smsEnabled && (
            <div className="border-t border-[#2A2A2A] pt-4">
              <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-2">Test SMS</p>
              <div className="flex gap-2">
                <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+8801XXXXXXXXX" className="input-base flex-1" />
                <button onClick={() => { setTestResult(''); testMut.mutate(testPhone); }} disabled={!testPhone || testMut.isPending}
                  className="bg-[#2A2A2A] hover:bg-[#333] text-white px-4 py-2.5 font-body text-sm transition-colors disabled:opacity-40">
                  {testMut.isPending ? 'Sending...' : 'Send Test'}
                </button>
              </div>
              {testResult && <p className={`text-xs font-body mt-2 ${testResult.includes('success') ? 'text-green-600' : 'text-[#D62B2B]'}`}>{testResult}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Notification Toggles */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">SMS Notifications</p>
          <p className="text-[#666] font-body text-[10px] mt-0.5">Choose which events trigger SMS notifications</p>
        </div>
        <div className="p-5 space-y-3">
          <label className="flex items-center justify-between cursor-pointer py-2 border-b border-[#2A2A2A] last:border-0">
            <div>
              <p className="text-sm font-body text-white">Void Item OTP</p>
              <p className="text-[10px] font-body text-[#666]">Send OTP to manager when cashier requests to void an item</p>
            </div>
            <input type="checkbox" checked={settings.notifyVoidOtp} disabled={!isOwner}
              onChange={(e) => updateMut.mutate({ notifyVoidOtp: e.target.checked })}
              className="accent-[#D62B2B] w-4 h-4" />
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── Kitchen Settings ────────────────────────────────────────────────────────

function KitchenSettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery<{ useKds: boolean }>({
    queryKey: ['branch-settings'],
    queryFn: () => api.get('/branch-settings'),
  });

  const updateMut = useMutation({
    mutationFn: (data: { useKds: boolean }) => api.patch('/branch-settings', data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['branch-settings'] }),
  });

  if (isLoading || !settings) return null;

  return (
    <div className="mt-8">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Operations</p>
        <h2 className="font-display text-2xl text-white tracking-wide">KITCHEN</h2>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="pr-6">
            <p className="text-sm font-body text-white font-medium mb-1">Use Kitchen Display System (KDS)</p>
            <p className="text-xs font-body text-[#999] leading-relaxed">
              When off, kitchen tickets auto-print on the cashier PC's default printer the moment an order is fired. Use this when your kitchen has a thermal printer but no screen.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <span className="text-xs font-body text-[#999]">{settings.useKds ? 'On' : 'Off'}</span>
            <input
              type="checkbox"
              checked={settings.useKds}
              disabled={!isOwner || updateMut.isPending}
              onChange={(e) => updateMut.mutate({ useKds: e.target.checked })}
              className="accent-[#D62B2B] w-4 h-4"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function UnitConversionSection({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [convForm, setConvForm] = useState({ fromUnit: 'KG' as string, toUnit: 'G' as string, factor: '1000' });

  const { data: conversions = [] } = useQuery<UnitConversion[]>({
    queryKey: ['unit-conversions'],
    queryFn: () => api.get('/unit-conversions'),
  });

  const upsertMut = useMutation({
    mutationFn: (dto: { fromUnit: string; toUnit: string; factor: number }) =>
      api.post('/unit-conversions', dto),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['unit-conversions'] }),
  });

  const deleteMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api.delete(`/unit-conversions?from=${from}&to=${to}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['unit-conversions'] }),
  });

  // Deduplicate: only show each pair once (fromUnit < toUnit alphabetically)
  const uniqueConversions = conversions.filter((c) => c.fromUnit < c.toUnit);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const factor = parseFloat(convForm.factor);
    if (!factor || factor <= 0 || convForm.fromUnit === convForm.toUnit) return;
    upsertMut.mutate({ fromUnit: convForm.fromUnit, toUnit: convForm.toUnit, factor });
  };

  return (
    <div className="mt-8">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Measurement</p>
        <h2 className="font-display text-2xl text-white tracking-wide">UNIT CONVERSIONS</h2>
      </div>
      <p className="text-[#999] font-body text-sm mb-4">
        Define conversion rates between measurement units. Both directions are created automatically.
      </p>

      {/* Existing conversions table */}
      {uniqueConversions.length > 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A] mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                <th className="text-left px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">From</th>
                <th className="text-left px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">To</th>
                <th className="text-left px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">Factor</th>
                {isOwner && <th className="text-right px-4 py-3 text-[#999] font-body text-xs tracking-widest uppercase">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {uniqueConversions.map((c) => (
                <tr key={c.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-4 py-3 font-body text-sm text-white">{c.fromUnit}</td>
                  <td className="px-4 py-3 font-body text-sm text-white">{c.toUnit}</td>
                  <td className="px-4 py-3 font-body text-sm text-white">
                    1 {c.fromUnit} = {Number(c.factor).toFixed(6).replace(/\.?0+$/, '')} {c.toUnit}
                  </td>
                  {isOwner && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteMut.mutate({ from: c.fromUnit, to: c.toUnit })}
                        disabled={deleteMut.isPending}
                        className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uniqueConversions.length === 0 && (
        <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-6 text-center mb-6">
          <p className="text-[#999] font-body text-sm">No custom conversions defined yet. Built-in conversions (KG/G, L/ML, DOZEN/PCS) are always available.</p>
        </div>
      )}

      {/* Add conversion form */}
      {isOwner && (
        <form onSubmit={handleAdd} className="bg-[#161616] border border-[#2A2A2A] p-5">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-3">Add Conversion</p>
          <div className="grid grid-cols-4 gap-3 items-end">
            <Field label="From Unit">
              <select
                value={convForm.fromUnit}
                onChange={(e) => setConvForm((f) => ({ ...f, fromUnit: e.target.value }))}
                className="input-base"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="To Unit">
              <select
                value={convForm.toUnit}
                onChange={(e) => setConvForm((f) => ({ ...f, toUnit: e.target.value }))}
                className="input-base"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Factor (1 From = X To)">
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                value={convForm.factor}
                onChange={(e) => setConvForm((f) => ({ ...f, factor: e.target.value }))}
                className="input-base"
              />
            </Field>
            <button
              type="submit"
              disabled={upsertMut.isPending || convForm.fromUnit === convForm.toUnit}
              className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-4 py-2.5 font-body font-medium text-sm transition-colors disabled:opacity-40"
            >
              {upsertMut.isPending ? 'Saving...' : 'Add'}
            </button>
          </div>
          {upsertMut.isError && (
            <p className="text-sm font-body text-[#D62B2B] mt-2">
              {(upsertMut.error as Error).message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

// ─── Payment Methods Management (Two-Level: Categories + Options) ───────────

interface PMOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  account: { id: string; name: string; type: string } | null;
}

interface PMCategory {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  options: PMOption[];
}

interface AccountRef { id: string; name: string; type: string }

function PaymentMethodsSection() {
  const qc = useQueryClient();
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [addingOptionFor, setAddingOptionFor] = useState<string | null>(null);
  const [optCode, setOptCode] = useState('');
  const [optName, setOptName] = useState('');
  const [optAccountId, setOptAccountId] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatName, setNewCatName] = useState('');

  const { data: categories = [] } = useQuery<PMCategory[]>({
    queryKey: ['payment-methods'],
    queryFn: () => api.get('/payment-methods'),
  });

  const { data: allAccounts = [] } = useQuery<AccountRef[]>({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts'),
    select: (d: any[]) => d.filter((a) => a.isActive !== false).map((a) => ({ id: a.id, name: a.name, type: a.type })),
  });

  const toggleCatMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/payment-methods/${id}`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payment-methods'] }),
  });

  const createOptMut = useMutation({
    mutationFn: (dto: { categoryId: string; code: string; name: string; accountId?: string; isDefault?: boolean }) =>
      api.post('/payment-methods/options', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payment-methods'] });
      setAddingOptionFor(null);
      setOptCode('');
      setOptName('');
      setOptAccountId('');
    },
  });

  const updateOptMut = useMutation({
    mutationFn: ({ id, ...dto }: { id: string; name?: string; accountId?: string | null; isActive?: boolean; isDefault?: boolean }) =>
      api.patch(`/payment-methods/options/${id}`, dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payment-methods'] }),
  });

  const deleteOptMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payment-methods/options/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payment-methods'] }),
  });

  const createCatMut = useMutation({
    mutationFn: (dto: { code: string; name: string }) => api.post('/payment-methods', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payment-methods'] });
      setAddingCat(false);
      setNewCatCode('');
      setNewCatName('');
    },
  });

  const deleteCatMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payment-methods/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payment-methods'] }),
  });

  const toggleExpand = (catId: string) => {
    setExpandedCat((prev) => (prev === catId ? null : catId));
    setAddingOptionFor(null);
  };

  return (
    <div className="bg-[#161616] border border-[#2A2A2A]">
      <div className="px-5 py-4 border-b border-[#2A2A2A]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Payment Methods</p>
            <p className="text-[#666] font-body text-[10px] mt-0.5">Categories and their payment options. Click a category to manage its options.</p>
          </div>
          <button
            onClick={() => setAddingCat(true)}
            className="font-body text-xs tracking-widest uppercase text-[#FFA726] hover:text-white transition-colors"
          >
            + Add Category
          </button>
        </div>
      </div>
      <div className="p-5 space-y-2">
        {addingCat && (
          <div className="border border-[#FFA726] bg-[#0D0D0D] p-4 space-y-3">
            <p className="text-white font-body text-sm font-semibold">New Payment Category</p>
            <div className="flex gap-2">
              <input
                value={newCatCode}
                onChange={(e) => setNewCatCode(e.target.value.toUpperCase())}
                placeholder="Code (e.g. CASH)"
                className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] text-white px-3 py-2 font-mono text-xs"
              />
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Name (e.g. Cash)"
                className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] text-white px-3 py-2 font-body text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setAddingCat(false); setNewCatCode(''); setNewCatName(''); }}
                className="font-body text-xs tracking-widest uppercase text-[#666] hover:text-white px-3 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => createCatMut.mutate({ code: newCatCode, name: newCatName })}
                disabled={!newCatCode.trim() || !newCatName.trim() || createCatMut.isPending}
                className="font-body text-xs tracking-widest uppercase bg-[#FFA726] text-black px-4 py-1 hover:bg-[#FFB74D] disabled:opacity-50"
              >
                {createCatMut.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {categories.map((cat) => {
          const isExpanded = expandedCat === cat.id;
          return (
            <div key={cat.id} className="border border-[#2A2A2A]">
              {/* Category header */}
              <div
                className="flex items-center justify-between bg-[#0D0D0D] px-4 py-3 cursor-pointer select-none"
                onClick={() => toggleExpand(cat.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[#666] text-xs">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span className="font-mono text-white text-xs bg-[#2A2A2A] px-2 py-0.5">{cat.code}</span>
                  <span className="text-white font-body text-sm">{cat.name}</span>
                  <span className="text-[#666] font-body text-[10px]">({cat.options.length} option{cat.options.length !== 1 ? 's' : ''})</span>
                  {!cat.isActive && <span className="text-[#666] font-body text-[10px]">(inactive)</span>}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCatMut.mutate({ id: cat.id, isActive: !cat.isActive }); }}
                    className={`font-body text-xs tracking-widest uppercase transition-colors ${cat.isActive ? 'text-[#FFA726] hover:text-white' : 'text-[#4CAF50] hover:text-white'}`}
                  >
                    {cat.isActive ? 'Disable' : 'Enable'}
                  </button>
                  {cat.options.length === 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Delete category "${cat.name}"?`)) deleteCatMut.mutate(cat.id); }}
                      className="font-body text-xs tracking-widest uppercase text-red-500 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Options list */}
              {isExpanded && (
                <div className="bg-[#111] px-4 py-3 space-y-2 border-t border-[#2A2A2A]">
                  {cat.options.length === 0 && (
                    <p className="text-[#666] font-body text-xs text-center py-2">No options yet. Add one below.</p>
                  )}
                  {cat.options.map((opt) => (
                    <div key={opt.id} className="flex items-center justify-between bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[#DDD9D3] text-[10px] bg-[#1A1A1A] px-1.5 py-0.5">{opt.code}</span>
                        <span className="text-white font-body text-sm">{opt.name}</span>
                        {opt.isDefault && <span className="text-[#4CAF50] font-body text-[10px]">(default)</span>}
                        {!opt.isActive && <span className="text-[#666] font-body text-[10px]">(inactive)</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Account link */}
                        <select
                          value={opt.account?.id ?? ''}
                          onChange={(e) => updateOptMut.mutate({ id: opt.id, accountId: e.target.value || null })}
                          className="bg-[#161616] border border-[#2A2A2A] text-[#DDD9D3] text-[10px] font-body px-2 py-1 outline-none focus:border-[#D62B2B]"
                        >
                          <option value="">No account</option>
                          {allAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                          ))}
                        </select>
                        <button
                          onClick={() => updateOptMut.mutate({ id: opt.id, isActive: !opt.isActive })}
                          className={`font-body text-[10px] tracking-widest uppercase transition-colors ${opt.isActive ? 'text-[#FFA726] hover:text-white' : 'text-[#4CAF50] hover:text-white'}`}
                        >
                          {opt.isActive ? 'Disable' : 'Enable'}
                        </button>
                        {!opt.isDefault && (
                          <button
                            onClick={() => updateOptMut.mutate({ id: opt.id, isDefault: true })}
                            className="text-[#666] hover:text-white font-body text-[10px] tracking-widest uppercase transition-colors"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm(`Delete option "${opt.name}"?`)) deleteOptMut.mutate(opt.id); }}
                          className="text-[#D62B2B] hover:text-[#F03535] font-body text-[10px] tracking-widest uppercase transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add option form */}
                  {addingOptionFor === cat.id ? (
                    <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Code *</label>
                          <input
                            value={optCode}
                            onChange={(e) => setOptCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="e.g. BKASH"
                            className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#D62B2B]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Name *</label>
                          <input
                            value={optName}
                            onChange={(e) => setOptName(e.target.value)}
                            placeholder="e.g. bKash"
                            className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs font-body focus:outline-none focus:border-[#D62B2B]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Account</label>
                          <select
                            value={optAccountId}
                            onChange={(e) => setOptAccountId(e.target.value)}
                            className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs font-body focus:outline-none focus:border-[#D62B2B]"
                          >
                            <option value="">None</option>
                            {allAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {createOptMut.error && <p className="text-[#D62B2B] font-body text-xs">{(createOptMut.error as Error).message}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => setAddingOptionFor(null)} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-white font-body text-xs px-3 py-1.5 transition-colors">Cancel</button>
                        <button
                          onClick={() => createOptMut.mutate({
                            categoryId: cat.id,
                            code: optCode,
                            name: optName,
                            accountId: optAccountId || undefined,
                            isDefault: cat.options.length === 0,
                          })}
                          disabled={!optCode || !optName || createOptMut.isPending}
                          className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-xs px-3 py-1.5 transition-colors disabled:opacity-50"
                        >
                          {createOptMut.isPending ? 'Creating...' : 'Add Option'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingOptionFor(cat.id); setOptCode(''); setOptName(''); setOptAccountId(''); }}
                      className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs transition-colors"
                    >
                      + Add Option
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {categories.length === 0 && <p className="text-[#666] font-body text-sm text-center py-4">No payment categories configured.</p>}
      </div>
    </div>
  );
}

// ─── Reservation Settings ────────────────────────────────────────────────────

function ReservationSettingsSection() {
  const qc = useQueryClient();

  const { data: settings } = useQuery<Record<string, any>>({
    queryKey: ['reservation-settings'],
    queryFn: () => api.get('/reservations/settings'),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  if (settings && !loaded) {
    setForm({
      openingTime: settings.openingTime ?? '09:00',
      closingTime: settings.closingTime ?? '23:00',
      reservationSlotMinutes: String(settings.reservationSlotMinutes ?? 90),
      reservationBlockMinutes: String(settings.reservationBlockMinutes ?? 60),
      reservationMaxBookingsPerSlot: String(settings.reservationMaxBookingsPerSlot ?? 12),
      reservationMaxPersonsPerSlot: String(settings.reservationMaxPersonsPerSlot ?? 40),
      reservationAutoReserveMinutes: String(settings.reservationAutoReserveMinutes ?? 30),
      reservationLateThresholdMinutes: String(settings.reservationLateThresholdMinutes ?? 30),
      reservationReminderMinutes: String(settings.reservationReminderMinutes ?? 60),
      reservationSmsEnabled: settings.reservationSmsEnabled ? 'true' : 'false',
      reservationSmsConfirmTemplate: settings.reservationSmsConfirmTemplate ?? '',
      reservationSmsRejectTemplate: settings.reservationSmsRejectTemplate ?? '',
      reservationSmsReminderTemplate: settings.reservationSmsReminderTemplate ?? '',
      reservationTermsOfService: settings.reservationTermsOfService ?? '',
    });
    setLoaded(true);
  }

  const saveMut = useMutation({
    mutationFn: () => api.patch('/reservations/settings', {
      openingTime: form.openingTime,
      closingTime: form.closingTime,
      reservationSlotMinutes: parseInt(form.reservationSlotMinutes) || 90,
      reservationBlockMinutes: parseInt(form.reservationBlockMinutes) || 60,
      reservationMaxBookingsPerSlot: parseInt(form.reservationMaxBookingsPerSlot) || 12,
      reservationMaxPersonsPerSlot: parseInt(form.reservationMaxPersonsPerSlot) || 40,
      reservationAutoReserveMinutes: parseInt(form.reservationAutoReserveMinutes) || 30,
      reservationLateThresholdMinutes: parseInt(form.reservationLateThresholdMinutes) || 30,
      reservationReminderMinutes: parseInt(form.reservationReminderMinutes) || 60,
      reservationSmsEnabled: form.reservationSmsEnabled === 'true',
      reservationSmsConfirmTemplate: form.reservationSmsConfirmTemplate || null,
      reservationSmsRejectTemplate: form.reservationSmsRejectTemplate || null,
      reservationSmsReminderTemplate: form.reservationSmsReminderTemplate || null,
      reservationTermsOfService: form.reservationTermsOfService || null,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reservation-settings'] }),
  });

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));
  const inputCls = 'bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] w-full';
  const labelCls = 'text-[#999] text-xs font-body font-medium tracking-widest uppercase block mb-1';

  return (
    <div className="bg-[#161616] border border-[#2A2A2A]">
      <div className="px-5 py-4 border-b border-[#2A2A2A]">
        <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Reservation Settings</p>
        <p className="text-[#666] font-body text-[10px] mt-0.5">Configure online booking, time slots, SMS notifications, and terms of service.</p>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Opening Time</label><input type="time" value={form.openingTime ?? ''} onChange={(e) => set('openingTime', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Closing Time</label><input type="time" value={form.closingTime ?? ''} onChange={(e) => set('closingTime', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={labelCls}>Slot Interval (min)</label><input type="number" min="15" value={form.reservationSlotMinutes ?? ''} onChange={(e) => set('reservationSlotMinutes', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Block from Open/Close (min)</label><input type="number" min="0" value={form.reservationBlockMinutes ?? ''} onChange={(e) => set('reservationBlockMinutes', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Reminder Before (min)</label><input type="number" min="0" value={form.reservationReminderMinutes ?? ''} onChange={(e) => set('reservationReminderMinutes', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Max Bookings per Slot</label><input type="number" min="1" value={form.reservationMaxBookingsPerSlot ?? ''} onChange={(e) => set('reservationMaxBookingsPerSlot', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Max Persons per Slot</label><input type="number" min="1" value={form.reservationMaxPersonsPerSlot ?? ''} onChange={(e) => set('reservationMaxPersonsPerSlot', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Auto-Reserve Table Before (min)</label><input type="number" min="0" value={form.reservationAutoReserveMinutes ?? ''} onChange={(e) => set('reservationAutoReserveMinutes', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Late Threshold for Red (min)</label><input type="number" min="1" value={form.reservationLateThresholdMinutes ?? ''} onChange={(e) => set('reservationLateThresholdMinutes', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="flex items-center gap-3 border-t border-[#2A2A2A] pt-4">
          <label className={labelCls}>Reservation SMS</label>
          <select value={form.reservationSmsEnabled ?? 'true'} onChange={(e) => set('reservationSmsEnabled', e.target.value)} className={inputCls + ' w-24'}>
            <option value="true">ON</option>
            <option value="false">OFF</option>
          </select>
        </div>
        <div className="space-y-3">
          <div><label className={labelCls}>Confirm SMS Template</label><textarea rows={2} value={form.reservationSmsConfirmTemplate ?? ''} onChange={(e) => set('reservationSmsConfirmTemplate', e.target.value)} placeholder="Your reservation at {branch} on {date} at {time} for {partySize} guest(s) is confirmed. {table}" className={inputCls} /></div>
          <div><label className={labelCls}>Reject SMS Template</label><textarea rows={2} value={form.reservationSmsRejectTemplate ?? ''} onChange={(e) => set('reservationSmsRejectTemplate', e.target.value)} placeholder="Sorry, your reservation at {branch} for {date} could not be confirmed." className={inputCls} /></div>
          <div><label className={labelCls}>Reminder SMS Template</label><textarea rows={2} value={form.reservationSmsReminderTemplate ?? ''} onChange={(e) => set('reservationSmsReminderTemplate', e.target.value)} placeholder="Reminder: Your reservation at {branch} is in {minutes} minutes." className={inputCls} /></div>
          <p className="text-[#555] text-[10px] font-body">Placeholders: {'{branch}'} {'{date}'} {'{time}'} {'{name}'} {'{partySize}'} {'{table}'} {'{minutes}'}</p>
        </div>
        <div><label className={labelCls}>Terms of Service</label><textarea rows={4} value={form.reservationTermsOfService ?? ''} onChange={(e) => set('reservationTermsOfService', e.target.value)} placeholder="By making a reservation, you agree to arrive within 30 minutes..." className={inputCls} /></div>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-6 py-2.5 transition-colors disabled:opacity-50">
          {saveMut.isPending ? 'Saving…' : saveMut.isSuccess ? 'Saved ✓' : 'Save Reservation Settings'}
        </button>
      </div>
    </div>
  );
}
