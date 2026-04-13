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

  const { data: related } = useQuery<RecommendedItem[]>({
    queryKey: ['recommended', getActiveBranchId(), item?.categoryId],
    queryFn: () =>
      api.getJson<RecommendedItem[]>(
        `/public/menu/${getActiveBranchId()}/recommended${item?.categoryId ? `?categoryId=${item.categoryId}` : ''}`
      ),
    enabled: !!item?.categoryId,
  });

  const relatedFiltered = (related ?? []).filter((r) => r.id !== itemId);
  const hasDiscount = item?.discountedPrice != null && item.discountedPrice < item.price;

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
  const itemDesc = item.seoDescription || item.description || `${item.name} at ${siteName}. ${formatCurrency(Number(item.price))}`;

  return (
    <div>
      <SEO
        title={itemTitle}
        description={itemDesc}
        image={item.imageUrl || undefined}
      />
      {/* Hero image header */}
      <section className="relative h-[50vh] md:h-[60vh] min-h-[400px] overflow-hidden bg-card">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
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

        {/* Price */}
        <div className="mt-4">
          <div className="flex items-baseline gap-3">
            {hasDiscount ? (
              <>
                <span className="font-display text-4xl text-accent">{formatCurrency(item.discountedPrice!)}</span>
                <span className="text-muted text-lg line-through">{formatCurrency(Number(item.price))}</span>
                {item.discountType === 'PERCENTAGE' && item.discountValue && (
                  <span className="bg-accent/20 text-accent text-xs font-semibold px-2 py-0.5">{item.discountValue}% OFF</span>
                )}
              </>
            ) : (
              <span className="font-display text-4xl text-accent">{formatCurrency(Number(item.price))}</span>
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
        {item.description && (
          <p className="text-muted leading-relaxed mt-6 max-w-2xl">{item.description}</p>
        )}

        {/* Tags */}
        {item.tags && (
          <div className="flex flex-wrap gap-2 mt-6">
            {(Array.isArray(item.tags) ? item.tags : String(item.tags).split(',').map(t => t.trim()).filter(Boolean)).map((tag) => (
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
        {content?.showKeyIngredients && item.ingredients && item.ingredients.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display text-2xl tracking-wider mb-4">KEY INGREDIENTS</h2>
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
              {item.ingredients.map((ing) => (
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

        {/* Info cards: Pieces, Prep Time, Spice Level */}
        {(
          (content?.showPieces && item.pieces != null) ||
          (content?.showPrepTime && item.prepTime) ||
          (content?.showSpiceLevel && item.spiceLevel)
        ) && (
          <div className="grid grid-cols-3 gap-4 mt-10">
            {content?.showPieces && item.pieces != null && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{item.pieces}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Pieces</p>
              </div>
            )}
            {content?.showPrepTime && item.prepTime && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{item.prepTime}</p>
                <p className="text-xs text-muted uppercase tracking-wider mt-1">Prep Time</p>
              </div>
            )}
            {content?.showSpiceLevel && item.spiceLevel && (
              <div className="glass p-4 text-center">
                <p className="font-display text-3xl text-accent">{item.spiceLevel}</p>
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
