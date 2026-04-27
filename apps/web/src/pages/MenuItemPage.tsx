import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useWebsiteContent, useBranding, getActiveBranchId } from '../lib/cms';
import { formatCurrency } from '@restora/utils';
import MenuCarousel from '../components/MenuCarousel';
import SEO from '../components/SEO';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Ingredient {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface VariantSummary {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  pieces?: number | null;
  prepTime?: string | null;
  spiceLevel?: string | null;
}

interface AddonOption {
  id: string;
  addonItemId: string;
  sortOrder: number;
  addon?: { id: string; name: string; price: number; isAvailable: boolean };
}
interface AddonGroup {
  id: string;
  name: string;
  minPicks: number;
  maxPicks: number;
  sortOrder: number;
  options: AddonOption[];
}

interface MenuItemDetail {
  id: string;
  name: string;
  slug?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  description: string | null;
  price: number;
  discountedPrice?: number;
  discountType?: string | null;
  discountValue?: number | null;
  discountEndDate?: string | null;
  discountApplicableDays?: string[] | null;
  imageUrl: string | null;
  categoryId: string;
  categoryName?: string;
  tags?: string[];
  pieces?: number | null;
  prepTime?: string | null;
  spiceLevel?: string | null;
  ingredients?: Ingredient[];
  /** Set on variant parent shells; render variant tabs when present. */
  isVariantParent?: boolean;
  variantParentId?: string | null;
  variants?: VariantSummary[];
  /** Addon groups attached to this menu item (or its parent shell).
   *  Customer site renders them informationally; ordering happens
   *  via QR / POS where the picker enforces min / max. */
  addonGroups?: AddonGroup[];
}

interface RecommendedItem {
  id: string;
  name: string;
  price: number;
  discountedPrice?: number;
  imageUrl: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function MenuItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();

  const { data: item, isLoading } = useQuery<MenuItemDetail>({
    queryKey: ['menu-item', getActiveBranchId(), itemId],
    queryFn: () => api.getJson<MenuItemDetail>(`/public/menu/${getActiveBranchId()}/item/${itemId}`),
    enabled: !!itemId,
  });

  // Variant tab selection. When the loaded item is a parent shell with
  // variants, default to the cheapest variant so the page never opens
  // with the parent's empty placeholder visible.
  const variants = (item?.isVariantParent ? item.variants : undefined) ?? [];
  const sortedVariants = [...variants].sort((a, b) => Number(a.price) - Number(b.price));
  const baseVariantPrice = sortedVariants[0]?.price ?? 0;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  useEffect(() => {
    // Reset whenever the parent changes; pick the cheapest as default.
    if (sortedVariants.length === 0) {
      setSelectedVariantId(null);
      return;
    }
    if (!selectedVariantId || !sortedVariants.some((v) => v.id === selectedVariantId)) {
      setSelectedVariantId(sortedVariants[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, sortedVariants.length]);

  // Fetch the selected variant's full detail so we can swap its
  // image / description / ingredients / pieces info into the page.
  // The list-level variant payload only carries the lightweight tab
  // fields (id, name, price, imageUrl); ingredients live on the
  // variant's own getMenuItem response.
  const { data: variantDetail } = useQuery<MenuItemDetail>({
    queryKey: ['menu-item-variant', selectedVariantId],
    queryFn: () => api.getJson<MenuItemDetail>(`/public/menu/${getActiveBranchId()}/item/${selectedVariantId}`),
    enabled: !!selectedVariantId && !!item?.isVariantParent,
  });

  // "Displayed" overlays the selected variant on top of the parent so
  // identity (category, SEO) sticks to the parent while the swap-able
  // bits (image, description, price, pieces, ingredients) reflect the
  // active variant. Standalone items: displayed === item.
  const displayed: MenuItemDetail | undefined = item?.isVariantParent && variantDetail
    ? {
        ...item,
        imageUrl: variantDetail.imageUrl ?? item.imageUrl,
        description: variantDetail.description ?? item.description,
        price: variantDetail.price,
        discountedPrice: variantDetail.discountedPrice,
        discountType: variantDetail.discountType,
        discountValue: variantDetail.discountValue,
        discountEndDate: variantDetail.discountEndDate,
        discountApplicableDays: variantDetail.discountApplicableDays,
        tags: variantDetail.tags,
        pieces: variantDetail.pieces,
        prepTime: variantDetail.prepTime,
        spiceLevel: variantDetail.spiceLevel,
        ingredients: variantDetail.ingredients,
        // Addons: prefer the variant's own groups when admin has
        // attached them per-variant, else fall back to the parent
        // shell's groups (the common case — admin attaches addons
        // once on the shell and they apply to every variant).
        addonGroups: (variantDetail.addonGroups && variantDetail.addonGroups.length > 0)
          ? variantDetail.addonGroups
          : item.addonGroups,
      }
    : item;

  const { data: related } = useQuery<RecommendedItem[]>({
    queryKey: ['recommended', getActiveBranchId(), item?.categoryId],
    queryFn: () =>
      api.getJson<RecommendedItem[]>(
        `/public/menu/${getActiveBranchId()}/recommended${item?.categoryId ? `?categoryId=${item.categoryId}` : ''}`
      ),
    enabled: !!item?.categoryId,
  });

  const relatedFiltered = (related ?? []).filter((r) => r.id !== itemId);
  const hasDiscount = displayed?.discountedPrice != null && displayed.discountedPrice < displayed.price;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted text-lg">Item not found</p>
        <Link to="/menu" className="text-accent hover:underline text-sm">
          Back to menu
        </Link>
      </div>
    );
  }

  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';
  const itemTitle = item.seoTitle || `${siteName} — ${item.name}`;
  // Use the parent's price when available (or the cheapest variant) so
  // the SEO description never reads ৳0 for a parent shell.
  const seoPrice = item.price > 0 ? item.price : baseVariantPrice;
  const itemDesc = item.seoDescription || item.description || `${item.name} at ${siteName}. ${formatCurrency(Number(seoPrice))}`;
  const heroImage = displayed?.imageUrl || item.imageUrl;
  const heroAlt = displayed?.name || item.name;

  return (
    <div>
      <SEO
        title={itemTitle}
        description={itemDesc}
        image={heroImage || undefined}
        type="product"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'MenuItem',
          name: item.name,
          description: itemDesc,
          image: heroImage || undefined,
          offers: seoPrice > 0 ? {
            '@type': 'Offer',
            price: (Number(seoPrice) / 100).toFixed(2),
            priceCurrency: 'BDT',
            availability: 'https://schema.org/InStock',
          } : undefined,
        }}
      />
      {/* Hero image header */}
      <section className="relative h-[50vh] md:h-[60vh] min-h-[400px] overflow-hidden bg-card">
        {heroImage ? (
          <img
            src={heroImage}
            alt={heroAlt}
            className="absolute inset-0 w-full h-full object-contain p-8 md:p-16"
          />
        ) : (
          <div className="absolute inset-0 bg-hover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/80" />

        {/* Back button */}
        <div className="absolute top-20 left-6 z-10">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/80 hover:text-white text-sm font-semibold transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>
      </section>

      {/* Item details */}
      <section className="max-w-4xl mx-auto px-6 -mt-20 relative z-10 pb-16">
        {/* Category badge */}
        {item.categoryName && (
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-accent mb-3">
            {item.categoryName}
          </span>
        )}

        {/* Name */}
        <h1 className="font-display text-5xl md:text-7xl tracking-wider leading-none">
          {item.name}
        </h1>

        {/* Variant tabs — only when this is a parent shell with at
            least one variant. Each tile shows the variant name + the
            price differential vs the cheapest variant ("+৳100"); the
            cheapest reads as its absolute price. Clicking swaps the
            hero image, description, ingredients, and info cards. */}
        {sortedVariants.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {sortedVariants.map((v) => {
              const diff = Number(v.price) - Number(baseVariantPrice);
              const active = selectedVariantId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVariantId(v.id)}
                  className={`flex flex-col items-start gap-0.5 px-4 py-2 border transition-colors text-left ${
                    active
                      ? 'bg-accent text-white border-accent'
                      : 'bg-card text-text border-border hover:border-accent/50'
                  }`}
                >
                  <span className="text-sm font-semibold">{v.name}</span>
                  <span className={`text-xs ${active ? 'text-white/80' : 'text-muted'}`}>
                    {diff <= 0
                      ? formatCurrency(Number(v.price))
                      : `+${formatCurrency(diff)}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Price */}
        <div className="mt-4">
          <div className="flex items-baseline gap-3">
            {hasDiscount ? (
              <>
                <span className="font-display text-4xl text-accent">{formatCurrency(displayed!.discountedPrice!)}</span>
                <span className="text-muted text-lg line-through">{formatCurrency(Number(displayed!.price))}</span>
                {displayed!.discountType === 'PERCENTAGE' && displayed!.discountValue && (
                  <span className="bg-accent/20 text-accent text-xs font-semibold px-2 py-0.5">{displayed!.discountValue}% OFF</span>
                )}
              </>
            ) : (
              <span className="font-display text-4xl text-accent">{formatCurrency(Number(displayed?.price ?? baseVariantPrice))}</span>
            )}
          </div>
          {hasDiscount && (
            <div className="flex flex-wrap gap-2 mt-3">
              {(() => {
                const tags: { label: string; color: string }[] = [];
                // Day-specific tag
                if (item.discountApplicableDays && item.discountApplicableDays.length > 0 && item.discountApplicableDays.length < 7) {
                  const days = item.discountApplicableDays.map(d => d.slice(0, 3)).join(', ');
                  tags.push({ label: `${days} Only`, color: 'bg-accent/20 text-accent' });
                }
                if (item.discountEndDate) {
                  const end = new Date(item.discountEndDate);
                  const now = new Date();
                  const diffMs = end.getTime() - now.getTime();
                  const diffDays = Math.floor(diffMs / 86400000);
                  const diffHours = Math.floor((diffMs % 86400000) / 3600000);
                  const diffMins = Math.floor((diffMs % 3600000) / 60000);

                  const formatted = end.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
                  tags.push({ label: `Valid ${formatted}`, color: 'bg-border text-muted' });

                  if (diffDays <= 7 && diffMs > 0) {
                    const countdown = diffDays > 0
                      ? `${diffDays}D ${diffHours}H ${diffMins}M left`
                      : `${diffHours}H ${diffMins}M left`;
                    tags.push({ label: countdown, color: 'bg-accent text-white' });
                  }
                }
                if (tags.length === 0) tags.push({ label: 'Limited Offer', color: 'bg-accent/20 text-accent' });
                return tags.map((t, i) => (
                  <span key={i} className={`${t.color} text-xs font-bold px-3 py-1 inline-flex items-center`}>
                    {t.label}
                  </span>
                ));
              })()}
            </div>
          )}
        </div>

        {/* Description */}
        {displayed?.description && (
          <p className="text-muted leading-relaxed mt-6 max-w-2xl">{displayed.description}</p>
        )}

        {/* Tags */}
        {displayed?.tags && (
          <div className="flex flex-wrap gap-2 mt-6">
            {(Array.isArray(displayed.tags) ? displayed.tags : String(displayed.tags).split(',').map(t => t.trim()).filter(Boolean)).map((tag) => (
              <span
                key={tag}
                className="text-xs font-semibold uppercase tracking-wider px-3 py-1 border border-border text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Key Ingredients */}
        {content?.showKeyIngredients && displayed?.ingredients && displayed.ingredients.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display text-2xl tracking-wider mb-4">KEY INGREDIENTS</h2>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
              {displayed.ingredients.map((ing) => (
                <div key={ing.id} className="flex-shrink-0 flex flex-col items-center gap-2 w-20">
                  {ing.imageUrl ? (
                    <img
                      src={ing.imageUrl}
                      alt={ing.name}
                      className="w-14 h-14 object-cover border border-border"
                    />
                  ) : (
                    <div className="w-14 h-14 bg-hover border border-border flex items-center justify-center text-muted text-xs">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <span className="text-xs text-muted text-center leading-tight">{ing.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available add-ons — informational only on the website
            (ordering happens via QR/POS where the picker enforces
            min/max). Lists each addon group with its name + min/max
            requirement, then the options inside with their price
            markup. Falls through to the parent's groups when a
            variant has none of its own. */}
        {displayed?.addonGroups && displayed.addonGroups.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display text-2xl tracking-wider mb-4">AVAILABLE ADD-ONS</h2>
            <div className="space-y-4">
              {displayed.addonGroups
                .filter((g) => (g.options ?? []).some((o) => o.addon?.isAvailable !== false))
                .map((group) => {
                  const requirement = group.minPicks > 0
                    ? `Pick ${group.minPicks === group.maxPicks ? group.minPicks : `${group.minPicks}–${group.maxPicks}`}`
                    : group.maxPicks > 0
                      ? `Optional · up to ${group.maxPicks}`
                      : 'Optional';
                  return (
                    <div key={group.id} className="border border-border bg-card p-4">
                      <div className="flex items-baseline justify-between mb-3">
                        <h3 className="font-semibold text-text">{group.name}</h3>
                        <span className="text-xs text-muted uppercase tracking-wider">{requirement}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(group.options ?? [])
                          .filter((o) => o.addon?.isAvailable !== false)
                          .map((opt) => {
                            const price = Number(opt.addon?.price ?? 0);
                            return (
                              <span
                                key={opt.id}
                                className="inline-flex items-baseline gap-2 bg-hover border border-border px-3 py-1.5 text-sm"
                              >
                                <span className="text-text">{opt.addon?.name ?? '—'}</span>
                                {price > 0 && (
                                  <span className="text-accent text-xs font-semibold">+{formatCurrency(price)}</span>
                                )}
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Info cards: Pieces, Prep Time, Spice Level */}
        {(
          (content?.showPieces && displayed?.pieces != null) ||
          (content?.showPrepTime && displayed?.prepTime) ||
          (content?.showSpiceLevel && displayed?.spiceLevel)
        ) && (
          <div className="grid grid-cols-3 gap-4 mt-10">
            {content?.showPieces && displayed?.pieces != null && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{displayed.pieces}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Pieces</p>
              </div>
            )}
            {content?.showPrepTime && displayed?.prepTime && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{displayed.prepTime}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Prep Time</p>
              </div>
            )}
            {content?.showSpiceLevel && displayed?.spiceLevel && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{displayed.spiceLevel}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Spice Level</p>
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-10 flex gap-4">
          <Link
            to="/menu"
            className="border border-border hover:border-accent text-text hover:text-accent font-display text-lg tracking-wider px-8 py-3 transition-colors"
          >
            Full Menu
          </Link>
          {content?.showReservation !== false && (
            <Link
              to="/reservation"
              className="bg-btn hover:opacity-90 text-white font-display text-lg tracking-wider px-8 py-3 transition-opacity"
            >
              Book a Table
            </Link>
          )}
        </div>
      </section>

      {/* You Might Also Like */}
      {relatedFiltered.length > 0 && (
        <section className="py-16 px-6 bg-card border-t border-border">
          <div className="max-w-7xl mx-auto">
            <p className="font-serif italic text-accent mb-2">You Might Also Like</p>
            <h2 className="font-display text-3xl tracking-wider mb-6">MORE TO EXPLORE</h2>
            <MenuCarousel
              items={relatedFiltered}
              onItemClick={(id) => navigate(`/menu/${id}`)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
