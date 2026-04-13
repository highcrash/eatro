import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface WebsiteContent {
  id: string;
  branchId: string;
  heroTitle: string;
  heroSubtitle: string | null;
  heroImageUrl: string | null;
  heroVideoUrl: string | null;
  heroCtaText: string;
  aboutTitle: string;
  aboutBody: string;
  aboutImageUrl: string | null;
  aboutSectionBg: string | null;
  aboutPoint1: string | null;
  aboutPoint2: string | null;
  aboutPoint3: string | null;
  aboutPoint4: string | null;
  openingHours: string | null;
  bannerBg: string | null;
  bannerText: string | null;
  contactNote: string | null;
  mapEmbedUrl: string | null;
  featuredCategoryIds: string[];
  galleryImages: string | null;       // JSON array of image URLs
  showGallery: boolean;
  showReviews: boolean;
  showReservation: boolean;
  showKeyIngredients: boolean;
  showPieces: boolean;
  showPrepTime: boolean;
  showSpiceLevel: boolean;
  accentColor: string | null;
  buttonColor: string | null;
  maintenanceMode: boolean;
  maintenanceBg: string | null;
  maintenanceText: string | null;
  notFoundBg: string | null;
  notFoundText: string | null;
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

/** Get the active branch ID from localStorage (set by BranchSelector) */
export function getActiveBranchId(): string {
  return localStorage.getItem('eatro-branch') || DEFAULT_BRANCH;
}

export function useBranding(branchId?: string) {
  const id = branchId ?? getActiveBranchId();
  return useQuery<PublicBranding>({
    queryKey: ['public-branding', id],
    queryFn: () => api.getJson<PublicBranding>(`/public/branding/${id}`),
    staleTime: 60_000,
  });
}

export function useWebsiteContent(branchId?: string) {
  const id = branchId ?? getActiveBranchId();
  return useQuery<WebsiteContent>({
    queryKey: ['public-website', id],
    queryFn: () => api.getJson<WebsiteContent>(`/public/website/${id}`),
    staleTime: 60_000,
  });
}
