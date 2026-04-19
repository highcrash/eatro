import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Branding } from '@restora/types';
import { api } from '../../lib/api';
import { useBranding, resolveLogoUrl } from '../../lib/branding';

interface Props { isOwner: boolean }

interface Form {
  name: string;
  address: string;
  phone: string;
  email: string;
  websiteTagline: string;
  billHeaderText: string;
  billFooterText: string;
  bin: string;
  mushakVersion: string;
  wifiPass: string;
  billLogoWidthPct: number;
  facebookUrl: string;
  instagramUrl: string;
}

const empty: Form = {
  name: '', address: '', phone: '', email: '',
  websiteTagline: '', billHeaderText: '', billFooterText: '',
  bin: '', mushakVersion: '', wifiPass: '',
  billLogoWidthPct: 80,
  facebookUrl: '', instagramUrl: '',
};

export default function BrandingSection({ isOwner }: Props) {
  const qc = useQueryClient();
  const { data: branding } = useBranding();
  const [form, setForm] = useState<Form>(empty);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [posLogoUrl, setPosLogoUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const posLogoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branding) return;
    setForm({
      name: branding.name,
      address: branding.address,
      phone: branding.phone,
      email: branding.email ?? '',
      websiteTagline: branding.websiteTagline ?? '',
      billHeaderText: branding.billHeaderText ?? '',
      billFooterText: branding.billFooterText ?? '',
      bin: branding.bin ?? '',
      mushakVersion: branding.mushakVersion ?? '',
      wifiPass: branding.wifiPass ?? '',
      billLogoWidthPct: Number(branding.billLogoWidthPct ?? 80),
      facebookUrl: branding.facebookUrl ?? '',
      instagramUrl: branding.instagramUrl ?? '',
    });
    setLogoUrl(branding.logoUrl);
    setPosLogoUrl(branding.posLogoUrl);
  }, [branding]);

  const saveMut = useMutation({
    mutationFn: () => api.patch<Branding>('/branding', {
      name: form.name,
      address: form.address,
      phone: form.phone,
      email: form.email || null,
      websiteTagline: form.websiteTagline || null,
      billHeaderText: form.billHeaderText || null,
      billFooterText: form.billFooterText || null,
      bin: form.bin || null,
      mushakVersion: form.mushakVersion || null,
      wifiPass: form.wifiPass || null,
      billLogoWidthPct: form.billLogoWidthPct,
      facebookUrl: form.facebookUrl || null,
      instagramUrl: form.instagramUrl || null,
      logoUrl,
      posLogoUrl,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branding'] });
      void qc.invalidateQueries({ queryKey: ['branches'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const uploadLogo = useMutation({
    mutationFn: async ({ file, target }: { file: File; target: 'logo' | 'posLogo' }) => {
      const res = await api.upload<{ url: string }>('/upload/image', file);
      return { url: res.url, target };
    },
    onSuccess: ({ url, target }) => {
      if (target === 'logo') setLogoUrl(url);
      else setPosLogoUrl(url);
    },
  });

  if (!branding) return null;

  return (
    <div className="mt-8">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Identity</p>
        <h2 className="font-display text-2xl text-white tracking-wide">BRANDING</h2>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] mb-4">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Logos &amp; Identity</p>
          <p className="text-[#666] font-body text-[10px] mt-0.5">Logos appear on POS sidebar, login screens, bills, and the public website.</p>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6">
          {/* Main logo */}
          <div>
            <label className="block text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-2">Main Logo</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-[#0D0D0D] border border-[#2A2A2A] flex items-center justify-center overflow-hidden">
                {logoUrl
                  ? <img src={resolveLogoUrl(logoUrl) ?? ''} alt="" className="max-w-full max-h-full object-contain" />
                  : <span className="text-[#444] text-[10px]">No logo</span>}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button" disabled={!isOwner}
                  onClick={() => logoInputRef.current?.click()}
                  className="text-xs font-body bg-[#2A2A2A] text-white px-3 py-1.5 hover:bg-[#1F1F1F] disabled:opacity-40"
                >
                  {uploadLogo.isPending ? 'Uploading…' : 'Upload Logo'}
                </button>
                {logoUrl && isOwner && (
                  <button type="button" onClick={() => setLogoUrl(null)} className="text-[10px] text-[#D62B2B] hover:underline">Remove</button>
                )}
                <input
                  ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate({ file: f, target: 'logo' }); e.currentTarget.value = ''; }}
                />
              </div>
            </div>
          </div>

          {/* POS logo */}
          <div>
            <label className="block text-xs font-body font-medium tracking-widest uppercase text-[#999] mb-2">POS Logo (optional)</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-[#0D0D0D] border border-[#2A2A2A] flex items-center justify-center overflow-hidden">
                {posLogoUrl
                  ? <img src={resolveLogoUrl(posLogoUrl) ?? ''} alt="" className="max-w-full max-h-full object-contain" />
                  : <span className="text-[#444] text-[10px]">Use main</span>}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button" disabled={!isOwner}
                  onClick={() => posLogoInputRef.current?.click()}
                  className="text-xs font-body bg-[#2A2A2A] text-white px-3 py-1.5 hover:bg-[#1F1F1F] disabled:opacity-40"
                >
                  Upload POS Logo
                </button>
                {posLogoUrl && isOwner && (
                  <button type="button" onClick={() => setPosLogoUrl(null)} className="text-[10px] text-[#D62B2B] hover:underline">Use main</button>
                )}
                <input
                  ref={posLogoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate({ file: f, target: 'posLogo' }); e.currentTarget.value = ''; }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] mb-4">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Restaurant details</p>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Name" required>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={!isOwner} className="input-base" />
          </Field>
          <Field label="Address" required>
            <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} disabled={!isOwner} className="input-base" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Phone" required>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} disabled={!isOwner} className="input-base" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={!isOwner} className="input-base" />
            </Field>
          </div>
          <Field label="Website Tagline">
            <input value={form.websiteTagline} onChange={(e) => setForm((f) => ({ ...f, websiteTagline: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="Fresh, fast, full of flavour" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Facebook URL">
              <input value={form.facebookUrl} onChange={(e) => setForm((f) => ({ ...f, facebookUrl: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="https://facebook.com/..." />
            </Field>
            <Field label="Instagram URL">
              <input value={form.instagramUrl} onChange={(e) => setForm((f) => ({ ...f, instagramUrl: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="https://instagram.com/..." />
            </Field>
          </div>
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] mb-4">
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">Bill / receipt text</p>
          <p className="text-[#666] font-body text-[10px] mt-0.5">Free text rendered above &amp; below items on every printed bill and receipt.</p>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Bill Header Text (optional)">
            <input value={form.billHeaderText} onChange={(e) => setForm((f) => ({ ...f, billHeaderText: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="e.g. VAT Reg #123 · Branch Downtown" />
          </Field>
          <Field label="Bill Footer Text (optional)">
            <textarea
              value={form.billFooterText}
              onChange={(e) => setForm((f) => ({ ...f, billFooterText: e.target.value }))}
              disabled={!isOwner} rows={3}
              className="input-base resize-y"
              placeholder={'Thank you for dining with us!\nVisit: www.example.com · Use code REPEAT10 next time'}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="BIN (optional)">
              <input value={form.bin} onChange={(e) => setForm((f) => ({ ...f, bin: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="e.g. 000929179-0101" />
            </Field>
            <Field label="Mushak / Tax Software Version (optional)">
              <input value={form.mushakVersion} onChange={(e) => setForm((f) => ({ ...f, mushakVersion: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="e.g. Mushak-6.3" />
            </Field>
          </div>
          <Field label="Wi-Fi Password (optional, printed on bill)">
            <input value={form.wifiPass} onChange={(e) => setForm((f) => ({ ...f, wifiPass: e.target.value }))} disabled={!isOwner} className="input-base" placeholder="e.g. mywifipass" />
          </Field>
          <Field label={`Bill Logo Width (${form.billLogoWidthPct}% of 80 mm paper)`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={form.billLogoWidthPct}
                onChange={(e) => setForm((f) => ({ ...f, billLogoWidthPct: Number(e.target.value) }))}
                disabled={!isOwner}
                className="flex-1 accent-[#D62B2B]"
              />
              <input
                type="number"
                min={10}
                max={100}
                value={form.billLogoWidthPct}
                onChange={(e) => setForm((f) => ({ ...f, billLogoWidthPct: Math.max(10, Math.min(100, Number(e.target.value) || 80)) }))}
                disabled={!isOwner}
                className="input-base w-20 text-center"
              />
            </div>
            <p className="text-[10px] text-[#666] mt-1">Only affects the thermal bill logo — web & admin use the original image.</p>
          </Field>
        </div>
      </div>

      {isOwner && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-8 py-3 font-body font-medium text-sm transition-colors disabled:opacity-40"
          >
            {saveMut.isPending ? 'Saving…' : 'Save Branding'}
          </button>
          {saved && <span className="text-sm font-body text-green-600">Branding saved.</span>}
          {saveMut.isError && <span className="text-sm font-body text-[#D62B2B]">{(saveMut.error as Error).message}</span>}
        </div>
      )}
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
