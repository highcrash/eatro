import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface LoyaltySettings {
  loyaltyEnabled: boolean;
  loyaltyTakaPerPoint: number;
  loyaltyTakaPerPointRedeem: number;
  loyaltyValidityDays: number;
  firstVisitCouponEnabled: boolean;
  firstVisitCouponType: 'PERCENTAGE' | 'FLAT';
  firstVisitCouponValue: number;
  firstVisitCouponValidityDays: number;
}

/**
 * Loyalty + first-visit-coupon configuration. The first-visit
 * settings drive the auto-generated welcome coupon attached to
 * every brand-new customer's payment SMS.
 */
export default function LoyaltySettingsSection({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery<LoyaltySettings>({
    queryKey: ['loyalty-settings'],
    queryFn: () => api.get('/loyalty/settings'),
  });

  const [form, setForm] = useState<LoyaltySettings>({
    loyaltyEnabled: false,
    loyaltyTakaPerPoint: 100,
    loyaltyTakaPerPointRedeem: 1,
    loyaltyValidityDays: 180,
    firstVisitCouponEnabled: false,
    firstVisitCouponType: 'PERCENTAGE',
    firstVisitCouponValue: 10,
    firstVisitCouponValidityDays: 30,
  });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      setForm(settings);
      setLoaded(true);
    }
  }, [settings, loaded]);

  const mut = useMutation({
    mutationFn: (patch: Partial<LoyaltySettings>) => api.patch('/loyalty/settings', patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loyalty-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  const set = <K extends keyof LoyaltySettings>(k: K, v: LoyaltySettings[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    mut.mutate({ [k]: v });
  };

  // The welcome-coupon value is admin-entered as TAKA when type is
  // FLAT and as a raw percent when type is PERCENTAGE — but the
  // server stores FLAT values in PAISA (mirrors Discount.value in
  // schema.prisma). Convert at the form boundary so the input
  // always shows taka and the request always sends paisa.
  const couponValueForDisplay = form.firstVisitCouponType === 'FLAT'
    ? form.firstVisitCouponValue / 100
    : form.firstVisitCouponValue;
  const setCouponValue = (taka: number) => {
    const stored = form.firstVisitCouponType === 'FLAT'
      ? Math.round(taka * 100)
      : taka;
    set('firstVisitCouponValue', stored);
  };
  // When the admin flips FLAT ↔ PERCENTAGE, re-encode the existing
  // numeric value so it stays meaningful in the new unit.
  const setCouponType = (next: 'PERCENTAGE' | 'FLAT') => {
    const current = form.firstVisitCouponValue;
    let migrated = current;
    if (form.firstVisitCouponType === 'FLAT' && next === 'PERCENTAGE') {
      // Was paisa; PERCENTAGE keeps the taka figure as a percent number
      migrated = Math.round(current / 100);
    } else if (form.firstVisitCouponType === 'PERCENTAGE' && next === 'FLAT') {
      // Was raw percent; treat as taka and convert to paisa
      migrated = Math.round(current * 100);
    }
    setForm((p) => ({ ...p, firstVisitCouponType: next, firstVisitCouponValue: migrated }));
    mut.mutate({ firstVisitCouponType: next, firstVisitCouponValue: migrated });
  };

  return (
    <div className="space-y-6">
      <section className="border border-[#2A2A2A] bg-[#161616]">
        <header className="px-5 py-3 border-b border-[#2A2A2A] flex justify-between items-center">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#888]">Marketing</p>
            <h2 className="text-lg font-bold text-white">Loyalty Programme</h2>
          </div>
          {saved && <span className="text-[#4CAF50] text-xs">Saved</span>}
        </header>

        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.loyaltyEnabled}
              onChange={(e) => set('loyaltyEnabled', e.target.checked)}
              disabled={!isOwner}
              className="mt-1 accent-[#D62B2B]"
            />
            <div>
              <span className="text-white text-sm">Enable loyalty programme</span>
              <p className="text-[10px] text-[#666] mt-0.5">
                When on, paid orders earn points and the payment SMS includes the points-earned line. Customers redeem on QR ordering.
              </p>
            </div>
          </label>

          <div className={form.loyaltyEnabled ? '' : 'opacity-40 pointer-events-none'}>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Taka per point (earn rate)">
                <input
                  type="number"
                  min={1}
                  value={form.loyaltyTakaPerPoint}
                  onChange={(e) => set('loyaltyTakaPerPoint', Number(e.target.value) || 100)}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                />
                <p className="text-[10px] text-[#666] mt-1">৳100 spent = 1 pt by default</p>
              </Field>
              <Field label="Taka per point (redeem rate)">
                <input
                  type="number"
                  min={1}
                  value={form.loyaltyTakaPerPointRedeem}
                  onChange={(e) => set('loyaltyTakaPerPointRedeem', Number(e.target.value) || 1)}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                />
                <p className="text-[10px] text-[#666] mt-1">1 pt = ৳1 off by default</p>
              </Field>
              <Field label="Validity (days)">
                <input
                  type="number"
                  min={0}
                  value={form.loyaltyValidityDays}
                  onChange={(e) => set('loyaltyValidityDays', Number(e.target.value) || 0)}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                />
                <p className="text-[10px] text-[#666] mt-1">Reset on every visit; 0 = no expiry</p>
              </Field>
            </div>
          </div>
        </div>
      </section>

      <section className="border border-[#2A2A2A] bg-[#161616]">
        <header className="px-5 py-3 border-b border-[#2A2A2A]">
          <p className="text-[10px] uppercase tracking-widest text-[#888]">Marketing</p>
          <h2 className="text-lg font-bold text-white">First-Visit Welcome Coupon</h2>
        </header>

        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.firstVisitCouponEnabled}
              onChange={(e) => set('firstVisitCouponEnabled', e.target.checked)}
              disabled={!isOwner}
              className="mt-1 accent-[#D62B2B]"
            />
            <div>
              <span className="text-white text-sm">Auto-generate a welcome coupon for new customers</span>
              <p className="text-[10px] text-[#666] mt-0.5">
                Every brand-new customer's first paid order gets a unique single-use coupon code attached to the payment SMS.
              </p>
            </div>
          </label>

          <div className={form.firstVisitCouponEnabled ? '' : 'opacity-40 pointer-events-none'}>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Type">
                <select
                  value={form.firstVisitCouponType}
                  onChange={(e) => setCouponType(e.target.value as 'PERCENTAGE' | 'FLAT')}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                >
                  <option value="PERCENTAGE">% off</option>
                  <option value="FLAT">Flat ৳ off</option>
                </select>
              </Field>
              <Field label={form.firstVisitCouponType === 'PERCENTAGE' ? 'Value (%)' : 'Value (৳)'}>
                <input
                  type="number"
                  min={1}
                  step={form.firstVisitCouponType === 'FLAT' ? '0.01' : '1'}
                  value={couponValueForDisplay}
                  onChange={(e) => setCouponValue(Number(e.target.value) || 1)}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Validity (days)">
                <input
                  type="number"
                  min={1}
                  value={form.firstVisitCouponValidityDays}
                  onChange={(e) => set('firstVisitCouponValidityDays', Number(e.target.value) || 1)}
                  disabled={!isOwner}
                  className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-[#888] mb-1 block">{label}</span>
      {children}
    </label>
  );
}
