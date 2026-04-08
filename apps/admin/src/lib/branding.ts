import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Branding, Theme, ThemeTokens } from '@restora/types';
import { api } from './api';

/**
 * Fetches branding for the logged-in branch. Cached forever — invalidated only
 * when admin saves branding or theme changes via Settings.
 */
export function useBranding() {
  return useQuery<Branding>({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/branding'),
    staleTime: Infinity,
  });
}

/** Apply a Theme's CSS variables to :root so Tailwind utility classes light up. */
export function applyThemeTokens(tokens: ThemeTokens) {
  const r = document.documentElement.style;
  r.setProperty('--theme-bg', tokens.bg);
  r.setProperty('--theme-surface', tokens.surface);
  r.setProperty('--theme-surface-alt', tokens.surfaceAlt);
  r.setProperty('--theme-border', tokens.border);
  r.setProperty('--theme-text', tokens.text);
  r.setProperty('--theme-text-muted', tokens.textMuted);
  r.setProperty('--theme-accent', tokens.accent);
  r.setProperty('--theme-accent-soft', tokens.accentSoft);
  r.setProperty('--theme-accent-hover', tokens.accentHover);
  r.setProperty('--theme-pop', tokens.pop);
  r.setProperty('--theme-pop-soft', tokens.popSoft);
  r.setProperty('--theme-warn', tokens.warn);
  r.setProperty('--theme-danger', tokens.danger);
  r.setProperty('--theme-info', tokens.info);
  r.setProperty('--theme-sidebar', tokens.sidebar);
  r.setProperty('--theme-sidebar-text', tokens.sidebarText);
  r.setProperty('--theme-sidebar-active-bg', tokens.sidebarActiveBg);
  r.setProperty('--theme-sidebar-active-text', tokens.sidebarActiveText);
  r.setProperty('--theme-radius', tokens.radius);
  r.setProperty('--theme-font-display', tokens.fontDisplay);
  r.setProperty('--theme-font-body', tokens.fontBody);
}

export function findTheme(themes: Theme[], slug: string): Theme | undefined {
  return themes.find((t) => t.slug === slug);
}

/**
 * React effect: applies the branding's selected POS theme tokens to :root.
 * Use in admin previews; in POS use the dedicated POS hook.
 */
export function useApplyTheme(branding: Branding | undefined, slug?: string) {
  useEffect(() => {
    if (!branding) return;
    const targetSlug = slug ?? branding.posTheme;
    const theme = findTheme(branding.themes, targetSlug) ?? branding.themes[0];
    if (theme) applyThemeTokens(theme.tokens);
  }, [branding, slug]);
}

/** Resolve the URL of an uploaded logo (handles relative /uploads paths). */
export function resolveLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return url; // dev proxy serves /uploads through Vite
}
