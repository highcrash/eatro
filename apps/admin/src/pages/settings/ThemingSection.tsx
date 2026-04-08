import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Branding, Theme } from '@restora/types';
import { api } from '../../lib/api';
import { useBranding } from '../../lib/branding';

interface Props { isOwner: boolean }

export default function ThemingSection({ isOwner }: Props) {
  const qc = useQueryClient();
  const { data: branding } = useBranding();

  const setThemeMut = useMutation({
    mutationFn: (dto: { posTheme?: string; websiteTheme?: string }) =>
      api.patch<Branding>('/branding/theme', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['branding'] }),
  });

  if (!branding) return null;

  return (
    <div className="mt-8">
      <div className="mb-4">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Appearance</p>
        <h2 className="font-display text-2xl text-white tracking-wide">THEMES</h2>
        <p className="text-[#666] font-body text-sm mt-1">Choose how POS terminals and the public website look.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <ThemeColumn
          title="POS Theme"
          activeSlug={branding.posTheme}
          themes={branding.themes.filter((t) => t.scope === 'pos' || t.scope === 'both')}
          onSelect={(slug) => setThemeMut.mutate({ posTheme: slug })}
          disabled={!isOwner || setThemeMut.isPending}
        />
        <ThemeColumn
          title="Website Theme"
          activeSlug={branding.websiteTheme}
          themes={branding.themes.filter((t) => t.scope === 'web' || t.scope === 'both')}
          onSelect={(slug) => setThemeMut.mutate({ websiteTheme: slug })}
          disabled={!isOwner || setThemeMut.isPending}
        />
      </div>

      {setThemeMut.isError && (
        <p className="text-sm font-body text-[#D62B2B]">{(setThemeMut.error as Error).message}</p>
      )}
      {setThemeMut.isSuccess && (
        <p className="text-sm font-body text-green-600">Theme saved. Refresh POS / website to see changes.</p>
      )}
    </div>
  );
}

function ThemeColumn({
  title, activeSlug, themes, onSelect, disabled,
}: {
  title: string;
  activeSlug: string;
  themes: Theme[];
  onSelect: (slug: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="bg-[#161616] border border-[#2A2A2A]">
      <div className="px-5 py-4 border-b border-[#2A2A2A]">
        <p className="text-xs font-body font-medium tracking-widest uppercase text-[#999]">{title}</p>
      </div>
      <div className="p-4 space-y-2">
        {themes.map((t) => {
          const active = t.slug === activeSlug;
          return (
            <button
              key={t.slug}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(t.slug)}
              className={`w-full text-left p-3 border transition-colors ${active ? 'border-[#D62B2B] bg-[#D62B2B]/10' : 'border-[#2A2A2A] hover:border-[#555]'} disabled:opacity-40`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-white font-body text-sm font-medium">{t.name}</span>
                  {t.builtIn && <span className="text-[9px] text-[#666] tracking-widest uppercase">Built-in</span>}
                </div>
                {active && <span className="text-[10px] text-[#D62B2B] tracking-widest uppercase font-bold">Active</span>}
              </div>
              {/* Color swatches */}
              <div className="flex gap-1.5">
                <Swatch color={t.tokens.bg} title="Background" />
                <Swatch color={t.tokens.surface} title="Surface" />
                <Swatch color={t.tokens.accent} title="Accent" />
                <Swatch color={t.tokens.pop} title="Pop" />
                <Swatch color={t.tokens.sidebar} title="Sidebar" />
                <Swatch color={t.tokens.text} title="Text" />
              </div>
            </button>
          );
        })}
        {themes.length === 0 && <p className="text-[#666] font-body text-xs">No themes available for this scope.</p>}
      </div>
    </div>
  );
}

function Swatch({ color, title }: { color: string; title: string }) {
  return (
    <div
      title={title}
      className="w-7 h-7 border border-[#2A2A2A]"
      style={{ background: color }}
    />
  );
}
