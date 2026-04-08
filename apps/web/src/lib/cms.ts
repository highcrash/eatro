import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface WebsiteContent {
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
}

export interface PublicBranding {
  branchId: string;
  name: string;
  address: string;
  phone: string;
  email: string | null;
  logoUrl: string | null;
  websiteTagline: string | null;
  billHeaderText: string | null;
  billFooterText: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  posTheme: string;
  websiteTheme: string;
  themes: Array<{
    slug: string;
    name: string;
    tokens: Record<string, string>;
  }>;
}

export const DEFAULT_BRANCH = 'branch-main';

export function useBranding(branchId = DEFAULT_BRANCH) {
  return useQuery<PublicBranding>({
    queryKey: ['public-branding', branchId],
    queryFn: () => api.getJson<PublicBranding>(`/public/branding/${branchId}`),
    staleTime: 60_000,
  });
}

export function useWebsiteContent(branchId = DEFAULT_BRANCH) {
  return useQuery<WebsiteContent>({
    queryKey: ['public-website', branchId],
    queryFn: () => api.getJson<WebsiteContent>(`/public/website/${branchId}`),
    staleTime: 60_000,
  });
}
