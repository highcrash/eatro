import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Image as ImageIcon } from 'lucide-react';

import { api } from '../lib/api';

interface WebsiteContent {
  id: string;
  branchId: string;
  heroTitle: string;
  heroSubtitle: string | null;
  heroImageUrl: string | null;
  heroCtaText: string;
  aboutTitle: string;
  aboutBody: string;
  aboutImageUrl: string | null;
  contactNote: string | null;
  mapEmbedUrl: string | null;
  featuredCategoryIds: string[];
  updatedAt: string;
}

interface MenuCategory { id: string; name: string }

export default function WebsitePage() {
  const qc = useQueryClient();
  const { data: serverContent } = useQuery<WebsiteContent>({
    queryKey: ['website'],
    queryFn: () => api.get('/website'),
  });
  const { data: categories = [] } = useQuery<MenuCategory[]>({
    queryKey: ['menu-categories'],
    queryFn: () => api.get('/menu/categories'),
  });

  const [content, setContent] = useState<WebsiteContent | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (serverContent && !content) setContent(serverContent);
  }, [serverContent, content]);

  const saveMut = useMutation({
    mutationFn: (dto: Partial<WebsiteContent>) => api.patch<WebsiteContent>('/website', dto),
    onSuccess: (saved) => {
      setContent(saved);
      setSavedAt(Date.now());
      void qc.invalidateQueries({ queryKey: ['website'] });
    },
  });

  if (!content) return <p className="text-[#666] font-body text-sm p-8">Loading…</p>;

  const update = <K extends keyof WebsiteContent>(k: K, v: WebsiteContent[K]) => {
    setContent({ ...content, [k]: v });
  };

  const toggleCategory = (id: string) => {
    const next = content.featuredCategoryIds.includes(id)
      ? content.featuredCategoryIds.filter((c) => c !== id)
      : [...content.featuredCategoryIds, id];
    update('featuredCategoryIds', next);
  };

  const handleUpload = async (file: File, key: 'heroImageUrl' | 'aboutImageUrl') => {
    const fd = new FormData();
    fd.append('file', file);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiBase = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
    const res = await fetch(`${apiBase}/upload/image`, {
      method: 'POST',
      body: fd,
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
    });
    const json = await res.json();
    if (json.url) update(key, json.url);
  };

  const save = () => {
    saveMut.mutate({
      heroTitle: content.heroTitle,
      heroSubtitle: content.heroSubtitle,
      heroImageUrl: content.heroImageUrl,
      heroCtaText: content.heroCtaText,
      aboutTitle: content.aboutTitle,
      aboutBody: content.aboutBody,
      aboutImageUrl: content.aboutImageUrl,
      contactNote: content.contactNote,
      mapEmbedUrl: content.mapEmbedUrl,
      featuredCategoryIds: content.featuredCategoryIds,
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Settings</p>
          <h1 className="font-display text-white text-4xl tracking-wide">WEBSITE</h1>
        </div>
        <button
          onClick={save}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
        >
          <Save size={14} /> {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {savedAt && (
        <div className="px-8 py-2 bg-[#4CAF50]/10 border-b border-[#4CAF50]/20 text-[11px] font-body text-[#4CAF50]">
          ✓ Saved at {new Date(savedAt).toLocaleTimeString()}
        </div>
      )}

      <div className="flex-1 overflow-auto p-8 space-y-6 max-w-3xl">
        {/* Hero */}
        <Section title="Hero">
          <Field label="Title" value={content.heroTitle} onChange={(v) => update('heroTitle', v)} />
          <Field label="Subtitle" value={content.heroSubtitle ?? ''} onChange={(v) => update('heroSubtitle', v || null)} />
          <Field label="CTA Button Text" value={content.heroCtaText} onChange={(v) => update('heroCtaText', v)} />
          <ImageField
            label="Hero Image"
            value={content.heroImageUrl}
            onUpload={(f) => void handleUpload(f, 'heroImageUrl')}
            onClear={() => update('heroImageUrl', null)}
          />
        </Section>

        {/* About */}
        <Section title="About">
          <Field label="Title" value={content.aboutTitle} onChange={(v) => update('aboutTitle', v)} />
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Body</label>
            <textarea
              value={content.aboutBody}
              onChange={(e) => update('aboutBody', e.target.value)}
              rows={6}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            />
          </div>
          <ImageField
            label="About Image"
            value={content.aboutImageUrl}
            onUpload={(f) => void handleUpload(f, 'aboutImageUrl')}
            onClear={() => update('aboutImageUrl', null)}
          />
        </Section>

        {/* Contact */}
        <Section title="Contact">
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Note (above contact info)</label>
            <textarea
              value={content.contactNote ?? ''}
              onChange={(e) => update('contactNote', e.target.value || null)}
              rows={3}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            />
          </div>
          <Field
            label="Google Maps Embed URL"
            value={content.mapEmbedUrl ?? ''}
            onChange={(v) => update('mapEmbedUrl', v || null)}
          />
        </Section>

        {/* Featured Categories */}
        <Section title="Featured Menu Categories">
          <p className="text-[10px] font-body text-[#666] mb-2">
            Pick which categories appear on the public Home page.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={content.featuredCategoryIds.includes(c.id)}
                  onChange={() => toggleCategory(c.id)}
                  className="w-3.5 h-3.5 accent-[#D62B2B]"
                />
                <span className="text-xs font-body text-white">{c.name}</span>
              </label>
            ))}
            {categories.length === 0 && (
              <p className="col-span-2 text-xs font-body text-[#666]">No menu categories yet.</p>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#161616] border border-[#2A2A2A] p-6">
      <h3 className="font-display text-lg text-white tracking-widest mb-4">{title.toUpperCase()}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
      />
    </div>
  );
}

function ImageField({ label, value, onUpload, onClear }: { label: string; value: string | null; onUpload: (file: File) => void; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="w-20 h-20 object-cover border border-[#2A2A2A]" />
        ) : (
          <div className="w-20 h-20 bg-[#0D0D0D] border border-[#2A2A2A] flex items-center justify-center">
            <ImageIcon size={24} className="text-[#444]" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
            className="text-xs font-body text-[#999] file:bg-[#2A2A2A] file:border-0 file:text-white file:px-3 file:py-1 file:text-xs file:font-body file:cursor-pointer file:mr-2 cursor-pointer"
          />
          {value && (
            <button onClick={onClear} className="text-[10px] font-body text-[#666] hover:text-[#D62B2B] tracking-widest uppercase text-left">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
