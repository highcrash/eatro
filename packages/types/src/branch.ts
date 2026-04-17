import type { AuditFields } from './common';

// ─── Branch ───────────────────────────────────────────────────────────────────

export type StockPricingMethod = 'LAST_PURCHASE' | 'WEIGHTED_AVERAGE';

export interface Branch extends AuditFields {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string | null;
  currency: string;
  timezone: string;
  taxRate: number;
  vatEnabled: boolean;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  stockPricingMethod: StockPricingMethod;
  // Branding
  logoUrl: string | null;
  posLogoUrl: string | null;
  websiteTagline: string | null;
  billHeaderText: string | null;
  billFooterText: string | null;
  bin: string | null;
  mushakVersion: string | null;
  wifiPass: string | null;
  wifiSsid: string | null;
  qrGateEnabled: boolean;
  qrAllowedIps: string | null;
  qrGateMessage: string | null;
  billLogoWidthPct: number;
  facebookUrl: string | null;
  instagramUrl: string | null;
  isActive: boolean;
}

export interface CreateBranchDto {
  name: string;
  address: string;
  phone: string;
  email?: string;
  currency?: string;
  timezone?: string;
  taxRate?: number;
}

export interface UpdateBranchDto extends Partial<CreateBranchDto> {
  isActive?: boolean;
  vatEnabled?: boolean;
  serviceChargeEnabled?: boolean;
  serviceChargeRate?: number;
  stockPricingMethod?: StockPricingMethod;
  logoUrl?: string | null;
  posLogoUrl?: string | null;
  websiteTagline?: string | null;
  billHeaderText?: string | null;
  billFooterText?: string | null;
  bin?: string | null;
  mushakVersion?: string | null;
  wifiPass?: string | null;
  wifiSsid?: string | null;
  qrGateEnabled?: boolean;
  qrAllowedIps?: string | null;
  qrGateMessage?: string | null;
  billLogoWidthPct?: number;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
}

// ─── Themes ───────────────────────────────────────────────────────────────────

export type ThemeScope = 'pos' | 'web' | 'both';

export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;   // hover / nested surface
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;   // tinted accent for active states
  accentHover: string;
  pop: string;          // success / proceed colour
  popSoft: string;
  warn: string;
  danger: string;
  info: string;
  sidebar: string;
  sidebarText: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  radius: string;       // border radius value e.g. '0px' or '12px'
  fontDisplay: string;  // CSS font-family value
  fontBody: string;
}

export interface Theme {
  slug: string;
  name: string;
  scope: ThemeScope;
  builtIn?: boolean;
  tokens: ThemeTokens;
}

// ─── Branding aggregate (returned by GET /public/branding/:branchId) ─────────

export interface Branding {
  branchId: string;
  name: string;
  address: string;
  phone: string;
  email: string | null;
  logoUrl: string | null;
  posLogoUrl: string | null;
  websiteTagline: string | null;
  billHeaderText: string | null;
  billFooterText: string | null;
  bin: string | null;
  mushakVersion: string | null;
  wifiPass: string | null;
  wifiSsid: string | null;
  qrGateEnabled: boolean;
  qrAllowedIps: string | null;
  qrGateMessage: string | null;
  billLogoWidthPct: number;
  taxRate: number | null;
  vatEnabled: boolean;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  facebookUrl: string | null;
  instagramUrl: string | null;
  posTheme: string;
  websiteTheme: string;
  themes: Theme[];   // built-in + custom merged
}
