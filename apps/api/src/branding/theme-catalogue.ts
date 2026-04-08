import type { Theme } from '@restora/types';

/**
 * Built-in themes shipped with the app.
 * - basic   = the original red RESTORA design (sharp corners, Bebas Neue + DM Sans)
 * - sunrise = the new orange Restro POS design (rounded, Inter font)
 *
 * Custom themes are stored as JSON on BranchSetting.customThemes and merged
 * into this list when the branding endpoint is queried.
 */
export const BUILT_IN_THEMES: Theme[] = [
  {
    slug: 'sunrise',
    name: 'Sunrise (default)',
    scope: 'both',
    builtIn: true,
    tokens: {
      bg:                '#F5F5F5',
      surface:           '#FFFFFF',
      surfaceAlt:        '#F5F5F5',
      border:            '#EFEFEF',
      text:              '#171826',
      textMuted:         '#9F9F9E',
      accent:            '#FC8019',
      accentSoft:        '#FFE5D2',
      accentHover:       '#E96E0A',
      pop:               '#09AA29',
      popSoft:           '#E3F7E8',
      warn:              '#FFA726',
      danger:            '#E53935',
      info:              '#2196F3',
      sidebar:           '#FFFFFF',
      sidebarText:       '#9F9F9E',
      sidebarActiveBg:   '#FFE5D2',
      sidebarActiveText: '#FC8019',
      radius:            '12px',
      fontDisplay:       "'Inter', system-ui, sans-serif",
      fontBody:          "'Inter', system-ui, sans-serif",
    },
  },
  {
    slug: 'basic',
    name: 'Basic Red',
    scope: 'both',
    builtIn: true,
    tokens: {
      bg:                '#FAF9F7',
      surface:           '#FFFFFF',
      surfaceAlt:        '#F2F1EE',
      border:            '#DDD9D3',
      text:              '#111111',
      textMuted:         '#666666',
      accent:            '#D62B2B',
      accentSoft:        '#FCE4E4',
      accentHover:       '#F03535',
      pop:               '#4CAF50',
      popSoft:           '#E3F2E5',
      warn:              '#FFA726',
      danger:            '#D62B2B',
      info:              '#2196F3',
      sidebar:           '#0D0D0D',
      sidebarText:       '#DDD9D3',
      sidebarActiveBg:   '#D62B2B',
      sidebarActiveText: '#FFFFFF',
      radius:            '0px',
      fontDisplay:       "'Bebas Neue', sans-serif",
      fontBody:          "'DM Sans', sans-serif",
    },
  },
];

export function findTheme(slug: string, customThemes: Theme[] = []): Theme {
  return (
    [...BUILT_IN_THEMES, ...customThemes].find((t) => t.slug === slug) ??
    BUILT_IN_THEMES[0]
  );
}

export function parseCustomThemes(raw: string | null): Theme[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((t): t is Theme => typeof t === 'object' && t !== null && 'slug' in t && 'tokens' in t);
  } catch {
    return [];
  }
}
