import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Image as ImageIcon, ChevronDown, ChevronRight, Plus, X, Upload } from 'lucide-react';

import { api } from '../lib/api';
import { resizeImage, type ImagePreset } from '../lib/image-resize';

interface WebsiteContent {
  id: string;
  branchId: string;
  // Hero
  heroTitle: string;
  heroSubtitle: string | null;
  heroImageUrl: string | null;
  heroCtaText: string;
  heroVideoUrl: string | null;
  // About
  aboutTitle: string;
  aboutBody: string;
  aboutImageUrl: string | null;
  aboutPoint1: string | null;
  aboutPoint2: string | null;
  aboutPoint3: string | null;
  aboutPoint4: string | null;
  openingHours: string | null;
  // Contact
  contactNote: string | null;
  mapEmbedUrl: string | null;
  // Featured
  featuredCategoryIds: string[] | string;
  // Section visibility
  showReservation: boolean;
  showReviews: boolean;
  showGallery: boolean;
  showKeyIngredients: boolean;
  showPieces: boolean;
  showPrepTime: boolean;
  showSpiceLevel: boolean;
  showDeals: boolean;
  showChefsSpecial: boolean;
  // Gallery
  galleryImages: string | null;
  // Section backgrounds
  menuSectionBg: string | null;
  aboutSectionBg: string | null;
  reviewsSectionBg: string | null;
  reservationSectionBg: string | null;
  contactSectionBg: string | null;
  bannerBg: string | null;
  bannerText: string | null;
  // Theme
  websiteMode: string;
  accentColor: string;
  buttonColor: string;
  textColor: string | null;
  bgColor: string | null;
  logoUrl: string | null;
  // Menu visibility
  recommendedTag: string;
  hiddenCategoryIds: string | null;
  hiddenItemIds: string | null;
  // Maintenance & 404
  maintenanceMode: boolean;
  maintenanceBg: string | null;
  maintenanceText: string | null;
  notFoundBg: string | null;
  notFoundText: string | null;
  // SEO
  seoSiteName: string | null;
  seoHomeTitle: string | null;
  seoHomeDescription: string | null;
  seoHomeKeywords: string | null;
  seoMenuTitle: string | null;
  seoMenuDescription: string | null;
  seoAboutTitle: string | null;
  seoAboutDescription: string | null;
  seoContactTitle: string | null;
  seoContactDescription: string | null;
  seoReservationTitle: string | null;
  seoReservationDescription: string | null;
  seoOgImage: string | null;
  seoFavicon: string | null;
  // Marketing tags
  fbPixelId: string | null;
  googleAnalyticsId: string | null;
  //
  updatedAt: string;
}

interface MenuCategory { id: string; name: string; parentId?: string | null }

// Parse a JSON string array safely
function parseJsonArray(val: string | null): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

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
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (serverContent && !content) {
      // Ensure all boolean/string fields have safe defaults for pre-migration rows
      setContent({
        ...serverContent,
        showReservation: serverContent.showReservation ?? true,
        showReviews: serverContent.showReviews ?? true,
        showGallery: serverContent.showGallery ?? true,
        showKeyIngredients: serverContent.showKeyIngredients ?? true,
        showPieces: serverContent.showPieces ?? true,
        showPrepTime: serverContent.showPrepTime ?? true,
        showSpiceLevel: serverContent.showSpiceLevel ?? true,
        websiteMode: serverContent.websiteMode ?? 'dark',
        accentColor: serverContent.accentColor ?? '#D62B2B',
        buttonColor: serverContent.buttonColor ?? '#D62B2B',
        recommendedTag: serverContent.recommendedTag ?? 'Chef Special',
        maintenanceMode: serverContent.maintenanceMode ?? false,
      });
    }
  }, [serverContent, content]);

  const saveMut = useMutation({
    mutationFn: (dto: Partial<WebsiteContent>) => api.patch<WebsiteContent>('/website', dto),
    onSuccess: (saved) => {
      setContent(saved);
      setSavedAt(Date.now());
      void qc.invalidateQueries({ queryKey: ['website'] });
    },
  });

  if (!content) return <p className="text-[#666] font-body text-sm p-8">Loading website content...</p>;

  const update = <K extends keyof WebsiteContent>(k: K, v: WebsiteContent[K]) => {
    setContent({ ...content, [k]: v });
  };

  const featuredCategoryIds = parseJsonArray(typeof content.featuredCategoryIds === 'string' ? content.featuredCategoryIds : JSON.stringify(content.featuredCategoryIds ?? []));

  const toggleCategory = (id: string) => {
    const next = featuredCategoryIds.includes(id)
      ? featuredCategoryIds.filter((c: string) => c !== id)
      : [...featuredCategoryIds, id];
    update('featuredCategoryIds', next as any);
  };

  const toggleHiddenCategory = (id: string) => {
    const current = parseJsonArray(content.hiddenCategoryIds);
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    update('hiddenCategoryIds', next.length ? JSON.stringify(next) : null);
  };

  // Map CMS field names to image resize presets
  const presetMap: Partial<Record<string, ImagePreset>> = {
    heroImageUrl: 'hero', heroVideoUrl: 'hero',
    menuSectionBg: 'hero', aboutSectionBg: 'hero', reviewsSectionBg: 'hero',
    reservationSectionBg: 'hero', contactSectionBg: 'hero', bannerBg: 'hero',
    maintenanceBg: 'hero', notFoundBg: 'hero',
    aboutImageUrl: 'about',
    logoUrl: 'logo',
    seoOgImage: 'ogImage', seoFavicon: 'favicon',
  };

  const handleUpload = async (file: File, key: keyof WebsiteContent) => {
    setUploading(true);
    try {
      const preset = presetMap[key] ?? 'gallery';
      const resized = await resizeImage(file, preset);
      const json = await api.upload<{ url: string }>('/upload/image', resized);
      if (json.url) {
        update(key, json.url as WebsiteContent[typeof key]);
      } else {
        alert('Upload returned no URL');
      }
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message || 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleGalleryUpload = async (file: File) => {
    try {
      const resized = await resizeImage(file, 'gallery');
      const json = await api.upload<{ url: string }>('/upload/image', resized);
      if (json.url) {
        const current = parseJsonArray(content.galleryImages);
        update('galleryImages', JSON.stringify([...current, json.url]));
      }
    } catch (e) {
      alert((e as Error).message || 'Upload failed');
    }
  };

  const removeGalleryImage = (url: string) => {
    const current = parseJsonArray(content.galleryImages);
    const next = current.filter((u) => u !== url);
    update('galleryImages', next.length ? JSON.stringify(next) : null);
  };

  const save = () => {
    saveMut.mutate({
      heroTitle: content.heroTitle,
      heroSubtitle: content.heroSubtitle,
      heroImageUrl: content.heroImageUrl,
      heroCtaText: content.heroCtaText,
      heroVideoUrl: content.heroVideoUrl,
      aboutTitle: content.aboutTitle,
      aboutBody: content.aboutBody,
      aboutImageUrl: content.aboutImageUrl,
      aboutPoint1: content.aboutPoint1,
      aboutPoint2: content.aboutPoint2,
      aboutPoint3: content.aboutPoint3,
      aboutPoint4: content.aboutPoint4,
      openingHours: content.openingHours,
      contactNote: content.contactNote,
      mapEmbedUrl: content.mapEmbedUrl,
      featuredCategoryIds: Array.isArray(content.featuredCategoryIds) ? JSON.stringify(content.featuredCategoryIds) : content.featuredCategoryIds,
      showReservation: content.showReservation,
      showReviews: content.showReviews,
      showGallery: content.showGallery,
      showKeyIngredients: content.showKeyIngredients,
      showPieces: content.showPieces,
      showPrepTime: content.showPrepTime,
      showSpiceLevel: content.showSpiceLevel,
      showDeals: content.showDeals,
      showChefsSpecial: content.showChefsSpecial,
      galleryImages: content.galleryImages,
      menuSectionBg: content.menuSectionBg,
      aboutSectionBg: content.aboutSectionBg,
      reviewsSectionBg: content.reviewsSectionBg,
      reservationSectionBg: content.reservationSectionBg,
      contactSectionBg: content.contactSectionBg,
      bannerBg: content.bannerBg,
      bannerText: content.bannerText,
      websiteMode: content.websiteMode,
      accentColor: content.accentColor,
      buttonColor: content.buttonColor,
      textColor: content.textColor,
      bgColor: content.bgColor,
      // logoUrl is saved separately via /branding endpoint
      recommendedTag: content.recommendedTag,
      hiddenCategoryIds: content.hiddenCategoryIds,
      maintenanceMode: content.maintenanceMode,
      maintenanceBg: content.maintenanceBg,
      maintenanceText: content.maintenanceText,
      notFoundBg: content.notFoundBg,
      notFoundText: content.notFoundText,
      seoSiteName: content.seoSiteName,
      seoHomeTitle: content.seoHomeTitle,
      seoHomeDescription: content.seoHomeDescription,
      seoHomeKeywords: content.seoHomeKeywords,
      seoMenuTitle: content.seoMenuTitle,
      seoMenuDescription: content.seoMenuDescription,
      seoAboutTitle: content.seoAboutTitle,
      seoAboutDescription: content.seoAboutDescription,
      seoContactTitle: content.seoContactTitle,
      seoContactDescription: content.seoContactDescription,
      seoReservationTitle: content.seoReservationTitle,
      seoReservationDescription: content.seoReservationDescription,
      seoOgImage: content.seoOgImage,
      seoFavicon: content.seoFavicon,
      fbPixelId: content.fbPixelId,
      googleAnalyticsId: content.googleAnalyticsId,
    });
  };

  const galleryImages = parseJsonArray(content.galleryImages);
  const hiddenCategoryIds = parseJsonArray(content.hiddenCategoryIds);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Settings</p>
          <h1 className="font-display text-white text-4xl tracking-wide">WEBSITE CMS</h1>
        </div>
        <button
          onClick={save}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-5 py-2.5 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
        >
          <Save size={14} /> {saveMut.isPending ? 'Saving...' : 'Save All'}
        </button>
      </div>

      {savedAt && (
        <div className="px-8 py-2 bg-[#4CAF50]/10 border-b border-[#4CAF50]/20 text-[11px] font-body text-[#4CAF50]">
          Saved at {new Date(savedAt).toLocaleTimeString()}
        </div>
      )}

      <div className="flex-1 overflow-auto p-8 space-y-4 max-w-3xl">

        {/* 1. Theme & Colors */}
        <CollapsibleSection title="Theme & Colors" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Website Mode</label>
              <select
                value={content.websiteMode ?? 'dark'}
                onChange={(e) => update('websiteMode', e.target.value)}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div /> {/* spacer */}
            <ColorField label="Accent Color" value={content.accentColor ?? '#D62B2B'} onChange={(v) => update('accentColor', v)} />
            <ColorField label="Button Color" value={content.buttonColor ?? '#D62B2B'} onChange={(v) => update('buttonColor', v)} />
            <ColorField label="Text Color (override)" value={content.textColor ?? ''} onChange={(v) => update('textColor', v || null)} />
            <ColorField label="Background Color (override)" value={content.bgColor ?? ''} onChange={(v) => update('bgColor', v || null)} />
          </div>
          <div className="mt-4">
            <ImageField
              label="Logo"
              value={content.logoUrl ?? null}
              onUpload={async (f) => {
                try {
                  const json = await api.upload<{ url: string }>('/upload/image', f);
                  if (json.url) {
                    await api.patch('/branding', { logoUrl: json.url });
                    update('logoUrl', json.url as any);
                  }
                } catch (e) {
                  alert((e as Error).message || 'Upload failed');
                }
              }}
              onClear={async () => {
                await api.patch('/branding', { logoUrl: null });
                update('logoUrl', null as any);
              }}
            />
          </div>
        </CollapsibleSection>

        {/* 2. Hero Section */}
        <CollapsibleSection title="Hero Section" defaultOpen={false}>
          <Field label="Title" value={content.heroTitle} onChange={(v) => update('heroTitle', v)} />
          <Field label="Subtitle" value={content.heroSubtitle ?? ''} onChange={(v) => update('heroSubtitle', v || null)} />
          <Field label="CTA Button Text" value={content.heroCtaText} onChange={(v) => update('heroCtaText', v)} />
          <ImageField
            label="Hero Image"
            value={content.heroImageUrl}
            onUpload={(f) => void handleUpload(f, 'heroImageUrl')}
            onClear={() => update('heroImageUrl', null)}
          />
          <Field
            label="Hero Video URL (MP4)"
            value={content.heroVideoUrl ?? ''}
            onChange={(v) => update('heroVideoUrl', v || null)}
            placeholder="https://example.com/video.mp4"
          />
          {content.heroVideoUrl && (
            <div className="mt-2">
              <video src={content.heroVideoUrl} className="w-full max-w-sm border border-[#2A2A2A]" controls muted />
            </div>
          )}
        </CollapsibleSection>

        {/* 3. Sections Visibility */}
        <CollapsibleSection title="Sections Visibility" defaultOpen={false}>
          <p className="text-[10px] font-body text-[#666] mb-3">
            Toggle which sections are visible on the public website.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ToggleField label="Reservation Section" checked={content.showReservation ?? true} onChange={(v) => update('showReservation', v)} />
            <ToggleField label="Reviews Section" checked={content.showReviews ?? true} onChange={(v) => update('showReviews', v)} />
            <ToggleField label="Gallery Section" checked={content.showGallery ?? true} onChange={(v) => update('showGallery', v)} />
          </div>
          <div className="mt-4 pt-4 border-t border-[#2A2A2A]">
            <p className="text-[10px] font-body text-[#666] mb-3">
              Toggle menu item detail fields shown on the website.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ToggleField label="Key Ingredients" checked={content.showKeyIngredients ?? true} onChange={(v) => update('showKeyIngredients', v)} />
              <ToggleField label="Pieces / Quantity" checked={content.showPieces ?? true} onChange={(v) => update('showPieces', v)} />
              <ToggleField label="Prep Time" checked={content.showPrepTime ?? true} onChange={(v) => update('showPrepTime', v)} />
              <ToggleField label="Spice Level" checked={content.showSpiceLevel ?? true} onChange={(v) => update('showSpiceLevel', v)} />
            </div>
            <p className="text-[#666] text-[10px] font-body mt-3 mb-1">Homepage Sections</p>
            <div className="grid grid-cols-2 gap-2">
              <ToggleField label="Today's Deals Section" checked={content.showDeals ?? true} onChange={(v) => update('showDeals', v)} />
              <ToggleField label="Chef's Special Section" checked={content.showChefsSpecial ?? true} onChange={(v) => update('showChefsSpecial', v)} />
            </div>
          </div>
        </CollapsibleSection>

        {/* 4. Section Backgrounds */}
        <CollapsibleSection title="Section Backgrounds" defaultOpen={false}>
          <p className="text-[10px] font-body text-[#666] mb-3">
            Upload background images for each section. Leave empty for default.
          </p>
          <div className="space-y-4">
            <ImageField label="Menu Section Background" value={content.menuSectionBg} onUpload={(f) => void handleUpload(f, 'menuSectionBg')} onClear={() => update('menuSectionBg', null)} />
            <ImageField label="About Section Background" value={content.aboutSectionBg} onUpload={(f) => void handleUpload(f, 'aboutSectionBg')} onClear={() => update('aboutSectionBg', null)} />
            <ImageField label="Reviews Section Background" value={content.reviewsSectionBg} onUpload={(f) => void handleUpload(f, 'reviewsSectionBg')} onClear={() => update('reviewsSectionBg', null)} />
            <ImageField label="Reservation Section Background" value={content.reservationSectionBg} onUpload={(f) => void handleUpload(f, 'reservationSectionBg')} onClear={() => update('reservationSectionBg', null)} />
            <ImageField label="Contact Section Background" value={content.contactSectionBg} onUpload={(f) => void handleUpload(f, 'contactSectionBg')} onClear={() => update('contactSectionBg', null)} />
            <div className="pt-4 border-t border-[#2A2A2A]">
              <ImageField label="Banner Background" value={content.bannerBg} onUpload={(f) => void handleUpload(f, 'bannerBg')} onClear={() => update('bannerBg', null)} />
              <div className="mt-3">
                <TextareaField label="Banner Text" value={content.bannerText ?? ''} onChange={(v) => update('bannerText', v || null)} rows={2} />
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* 5. About Section */}
        <CollapsibleSection title="About Section" defaultOpen={false}>
          <Field label="Title" value={content.aboutTitle} onChange={(v) => update('aboutTitle', v)} />
          <TextareaField label="Body" value={content.aboutBody} onChange={(v) => update('aboutBody', v)} rows={5} />
          <ImageField
            label="About Image"
            value={content.aboutImageUrl}
            onUpload={(f) => void handleUpload(f, 'aboutImageUrl')}
            onClear={() => update('aboutImageUrl', null)}
          />
          <div className="pt-4 border-t border-[#2A2A2A]">
            <p className="text-[10px] font-body text-[#666] mb-3">
              About cards -- short highlight points displayed as cards.
            </p>
            <div className="space-y-3">
              <TextareaField label="Point 1" value={content.aboutPoint1 ?? ''} onChange={(v) => update('aboutPoint1', v || null)} rows={2} />
              <TextareaField label="Point 2" value={content.aboutPoint2 ?? ''} onChange={(v) => update('aboutPoint2', v || null)} rows={2} />
              <TextareaField label="Point 3" value={content.aboutPoint3 ?? ''} onChange={(v) => update('aboutPoint3', v || null)} rows={2} />
              <TextareaField label="Point 4" value={content.aboutPoint4 ?? ''} onChange={(v) => update('aboutPoint4', v || null)} rows={2} />
            </div>
          </div>
          <div className="mt-3">
            <Field
              label="Opening Hours"
              value={content.openingHours ?? ''}
              onChange={(v) => update('openingHours', v || null)}
              placeholder="Daily 11:00 - 23:00"
            />
          </div>
        </CollapsibleSection>

        {/* 6. Gallery */}
        <CollapsibleSection title="Gallery" defaultOpen={false}>
          <p className="text-[10px] font-body text-[#666] mb-3">
            Manage gallery images. These appear in the Gallery section on the public website.
          </p>
          {galleryImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              {galleryImages.map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt="" className="w-full h-24 object-cover border border-[#2A2A2A]" />
                  <button
                    onClick={() => removeGalleryImage(url)}
                    className="absolute top-1 right-1 bg-black/70 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {galleryImages.length === 0 && (
            <p className="text-xs font-body text-[#666] mb-4">No gallery images yet.</p>
          )}
          <GalleryUploadButton onUpload={handleGalleryUpload} />
        </CollapsibleSection>

        {/* 7. Menu Visibility */}
        <CollapsibleSection title="Menu Visibility" defaultOpen={false}>
          <Field
            label="Recommended Tag Label"
            value={content.recommendedTag ?? 'Chef Special'}
            onChange={(v) => update('recommendedTag', v)}
            placeholder="Chef Special"
          />
          <div className="pt-4 border-t border-[#2A2A2A]">
            <p className="text-[#666] text-xs font-body font-medium tracking-widest uppercase mb-2">Homepage Featured Categories</p>
            <p className="text-[10px] font-body text-[#666] mb-2">
              Pick categories to feature on the public Home page menu preview. The full Menu page always shows every category (minus hidden ones).
            </p>
            <CategoryTree
              categories={categories}
              checkedIds={featuredCategoryIds}
              onToggle={toggleCategory}
            />
          </div>
          <div className="pt-4 border-t border-[#2A2A2A]">
            <p className="text-[#666] text-xs font-body font-medium tracking-widest uppercase mb-2">Hide Specific Categories</p>
            <p className="text-[10px] font-body text-[#666] mb-2">
              Optional extra filter — categories checked here are force-hidden from the website even if they appear in the Visible list above.
            </p>
            <CategoryTree
              categories={categories}
              checkedIds={hiddenCategoryIds}
              onToggle={toggleHiddenCategory}
            />
            <p className="text-[10px] font-body text-[#555] mt-2 italic">
              Individual items can be hidden from the Menu page.
            </p>
          </div>
        </CollapsibleSection>

        {/* 8. Contact */}
        <CollapsibleSection title="Contact" defaultOpen={false}>
          <TextareaField
            label="Note (above contact info)"
            value={content.contactNote ?? ''}
            onChange={(v) => update('contactNote', v || null)}
            rows={3}
          />
          <Field
            label="Google Maps Embed URL"
            value={content.mapEmbedUrl ?? ''}
            onChange={(v) => update('mapEmbedUrl', v || null)}
          />
        </CollapsibleSection>

        {/* 9. Maintenance & 404 */}
        <CollapsibleSection title="Maintenance & 404 Pages">
          <div className="space-y-4">
            <div className="bg-[#1A0000] border border-[#D62B2B]/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-body text-sm font-semibold">Maintenance Mode</p>
                  <p className="text-[#666] font-body text-[10px]">When enabled, the entire website shows a maintenance page. All other pages are hidden.</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={content.maintenanceMode ?? false}
                    onChange={(e) => update('maintenanceMode', e.target.checked)}
                    className="accent-[#D62B2B] w-5 h-5"
                  />
                  <span className={`font-body text-xs tracking-widest uppercase ${content.maintenanceMode ? 'text-[#D62B2B]' : 'text-[#666]'}`}>
                    {content.maintenanceMode ? 'ENABLED' : 'DISABLED'}
                  </span>
                </label>
              </div>
              <ImageField label="Maintenance Background Image" value={content.maintenanceBg} onUpload={(f) => void handleUpload(f, 'maintenanceBg')} onClear={() => update('maintenanceBg', null)} />
              <Field
                label="Maintenance Text"
                value={content.maintenanceText ?? ''}
                onChange={(v) => update('maintenanceText', v || null)}
                placeholder="Our website is currently being updated. We'll be back shortly..."
              />
            </div>

            <p className="text-[#666] font-body text-xs font-medium tracking-widest uppercase pt-2">404 Not Found Page</p>
            <ImageField label="404 Background Image" value={content.notFoundBg} onUpload={(f) => void handleUpload(f, 'notFoundBg')} onClear={() => update('notFoundBg', null)} />
            <Field
              label="404 Custom Text"
              value={content.notFoundText ?? ''}
              onChange={(v) => update('notFoundText', v || null)}
              placeholder="The page you're looking for doesn't exist or has been moved."
            />
          </div>
        </CollapsibleSection>

        {/* 10. SEO */}
        <CollapsibleSection title="SEO — Search Engine Optimization">
          <div className="space-y-4">
            <p className="text-[#666] font-body text-[10px]">Control how your website appears in Google search results. Leave blank to use auto-generated defaults.</p>

            <Field label="Site Name (used across all pages)" value={content.seoSiteName ?? ''} onChange={(v) => update('seoSiteName', v || null)} placeholder="EATRO Restaurant" />

            <div className="grid grid-cols-2 gap-3">
              <ImageField label="Default OG Image (social sharing)" value={content.seoOgImage} onUpload={(f) => void handleUpload(f, 'seoOgImage' as any)} onClear={() => update('seoOgImage' as any, null)} />
              <ImageField label="Favicon" value={content.seoFavicon} onUpload={(f) => void handleUpload(f, 'seoFavicon' as any)} onClear={() => update('seoFavicon' as any, null)} />
            </div>

            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase pt-2">Home Page</p>
            <Field label="Title Tag" value={content.seoHomeTitle ?? ''} onChange={(v) => update('seoHomeTitle', v || null)} placeholder="EATRO — Where Flavor Takes The Lead" />
            <Field label="Meta Description" value={content.seoHomeDescription ?? ''} onChange={(v) => update('seoHomeDescription', v || null)} placeholder="Fine dining restaurant with fusion cuisine..." />
            <Field label="Keywords (comma-separated)" value={content.seoHomeKeywords ?? ''} onChange={(v) => update('seoHomeKeywords', v || null)} placeholder="restaurant, fine dining, reservation, menu" />

            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase pt-2">Menu Page</p>
            <Field label="Title Tag" value={content.seoMenuTitle ?? ''} onChange={(v) => update('seoMenuTitle', v || null)} placeholder="Menu — EATRO" />
            <Field label="Meta Description" value={content.seoMenuDescription ?? ''} onChange={(v) => update('seoMenuDescription', v || null)} placeholder="Explore our full menu..." />

            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase pt-2">About Page</p>
            <Field label="Title Tag" value={content.seoAboutTitle ?? ''} onChange={(v) => update('seoAboutTitle', v || null)} placeholder="About Us — EATRO" />
            <Field label="Meta Description" value={content.seoAboutDescription ?? ''} onChange={(v) => update('seoAboutDescription', v || null)} />

            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase pt-2">Contact Page</p>
            <Field label="Title Tag" value={content.seoContactTitle ?? ''} onChange={(v) => update('seoContactTitle', v || null)} placeholder="Contact — EATRO" />
            <Field label="Meta Description" value={content.seoContactDescription ?? ''} onChange={(v) => update('seoContactDescription', v || null)} />

            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase pt-2">Reservation Page</p>
            <Field label="Title Tag" value={content.seoReservationTitle ?? ''} onChange={(v) => update('seoReservationTitle', v || null)} placeholder="Book a Table — EATRO" />
            <Field label="Meta Description" value={content.seoReservationDescription ?? ''} onChange={(v) => update('seoReservationDescription', v || null)} />

            <p className="text-[#555] text-[10px] font-body mt-2">Individual menu item SEO (title, description) can be set per-item in the Menu page editor.</p>
          </div>
        </CollapsibleSection>

        {/* 11. Marketing tags */}
        <CollapsibleSection title="Marketing Tags — Facebook Pixel & Google Analytics">
          <div className="space-y-4">
            <p className="text-[#666] font-body text-[10px]">
              Paste the IDs (not the full snippets). The website injects the standard loader scripts
              automatically. Leave blank to disable that tag.
            </p>

            <Field
              label="Facebook Pixel ID"
              value={content.fbPixelId ?? ''}
              onChange={(v) => update('fbPixelId', v.trim() || null)}
              placeholder="e.g. 123456789012345 (numeric, 15–16 digits)"
            />
            <Field
              label="Google Analytics / Tag Manager ID"
              value={content.googleAnalyticsId ?? ''}
              onChange={(v) => update('googleAnalyticsId', v.trim() || null)}
              placeholder="e.g. G-XXXXXXXXXX (GA4) or GTM-XXXXXXX (Tag Manager)"
            />

            <p className="text-[#555] text-[10px] font-body mt-2">
              Find your Pixel ID in Facebook Events Manager → Data Sources. Find the Google ID in
              Analytics → Admin → Data Streams, or in Tag Manager → Container.
            </p>
          </div>
        </CollapsibleSection>

        {/* Bottom save button */}
        <div className="pt-4 pb-8 flex justify-end">
          <button
            onClick={save}
            disabled={saveMut.isPending || uploading}
            className="flex items-center gap-2 bg-[#D62B2B] text-white px-5 py-2.5 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
          >
            <Save size={14} /> {uploading ? 'Uploading...' : saveMut.isPending ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable sub-components                                           */
/* ------------------------------------------------------------------ */

function CategoryTree({
  categories,
  checkedIds,
  onToggle,
}: {
  categories: MenuCategory[];
  checkedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (categories.length === 0) {
    return <p className="text-xs font-body text-[#666]">No menu categories yet.</p>;
  }

  const parents = categories.filter((c) => !c.parentId);
  const childrenOf = new Map<string, MenuCategory[]>();
  for (const c of categories) {
    if (c.parentId) {
      const existing = childrenOf.get(c.parentId) ?? [];
      existing.push(c);
      childrenOf.set(c.parentId, existing);
    }
  }

  const Row = ({ c, isChild }: { c: MenuCategory; isChild?: boolean }) => (
    <label
      className={`flex items-center gap-2 bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 cursor-pointer ${isChild ? 'ml-5' : ''}`}
    >
      <input
        type="checkbox"
        checked={checkedIds.includes(c.id)}
        onChange={() => onToggle(c.id)}
        className="w-3.5 h-3.5 accent-[#D62B2B]"
      />
      {isChild && <span className="text-[#666] text-xs font-body select-none">↳</span>}
      <span className={`text-xs font-body ${isChild ? 'text-[#CCC]' : 'text-white font-medium'}`}>{c.name}</span>
    </label>
  );

  return (
    <div className="space-y-1">
      {parents.map((p) => {
        const kids = childrenOf.get(p.id) ?? [];
        return (
          <div key={p.id} className="space-y-1">
            <Row c={p} />
            {kids.map((child) => (
              <Row key={child.id} c={child} isChild />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-[#161616] border border-[#2A2A2A]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#1A1A1A] transition-colors"
      >
        <h3 className="font-display text-lg text-white tracking-widest">{title.toUpperCase()}</h3>
        {open ? <ChevronDown size={18} className="text-[#666]" /> : <ChevronRight size={18} className="text-[#666]" />}
      </button>
      {open && <div className="px-6 pb-6 space-y-3">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] placeholder:text-[#444]"
      />
    </div>
  );
}

function TextareaField({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] resize-y"
      />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 bg-[#0D0D0D] border border-[#2A2A2A] cursor-pointer p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] placeholder:text-[#444]"
        />
      </div>
    </div>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-[#D62B2B]"
      />
      <span className="text-xs font-body text-white">{label}</span>
    </label>
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

function GalleryUploadButton({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await onUpload(f);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" onChange={(e) => void handleFile(e)} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 bg-[#2A2A2A] text-white px-4 py-2 text-xs font-body font-medium hover:bg-[#333] transition-colors tracking-widest uppercase disabled:opacity-40"
      >
        {uploading ? (
          <><Upload size={14} className="animate-pulse" /> Uploading...</>
        ) : (
          <><Plus size={14} /> Add Image</>
        )}
      </button>
    </div>
  );
}
