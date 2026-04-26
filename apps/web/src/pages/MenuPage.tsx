import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getActiveBranchId, useWebsiteContent, useBranding } from '../lib/cms';
import { formatCurrency } from '@restora/utils';
import SEO from '../components/SEO';
import MenuCarousel from '../components/MenuCarousel';

// Inline chevron — web app has no icon dep, no point adding one for two
// glyphs. Stroke-currentColor lets the existing nav color tokens drive it.
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

function ItemCard({ it, navigate }: { it: any; navigate: (path: string) => void }) {
  const hasDiscount = it.discountedPrice != null && it.discountedPrice < it.price;
  // Variant parents carry a `variants` array (id, name, price, …).
  // We render compact tiles below the card price showing each variant
  // with its price differential vs the cheapest ("+৳100"), so the
  // customer sees the spread without having to open the detail page.
  const variants: Array<{ id: string; name: string; price: number }> = Array.isArray(it.variants) ? it.variants : [];
  const sortedVariants = variants
    .slice()
    .sort((a, b) => Number(a.price) - Number(b.price));
  const baseVariantPrice = sortedVariants[0]?.price ?? 0;
  const isVariantParent = !!it.isVariantParent && sortedVariants.length > 0;
  // For variant parents the displayed price = cheapest variant.
  const displayPrice = isVariantParent && Number(it.price) === 0 ? baseVariantPrice : Number(it.price);
  return (
    <button
      onClick={() => navigate(`/menu/${it.slug || it.id}`)}
      className="bg-card border border-border hover:border-accent/40 transition-colors text-left group relative"
    >
      {hasDiscount && (
        <span className="absolute top-2 right-2 z-10 bg-accent text-white text-xs font-bold px-2 py-0.5">
          {it.discountType === 'PERCENTAGE' ? `${it.discountValue}%` : `৳${(it.discountValue ?? 0) / 100}`} OFF
        </span>
      )}
      <div className="aspect-square bg-hover overflow-hidden">
        {it.imageUrl ? (
          <img src={it.imageUrl} alt={it.name} className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-3xl">🍽️</div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-text">{it.name}</h3>
        {it.description && <p className="text-xs text-muted mt-1 line-clamp-2">{it.description}</p>}
        <div className="mt-3 flex items-baseline gap-2">
          {hasDiscount ? (
            <>
              <span className="text-accent font-bold">{formatCurrency(it.discountedPrice!)}</span>
              <span className="text-muted text-xs line-through">{formatCurrency(displayPrice)}</span>
            </>
          ) : (
            <span className="text-accent font-bold">
              {isVariantParent && <span className="text-muted text-xs font-normal mr-1">From</span>}
              {formatCurrency(displayPrice)}
            </span>
          )}
        </div>
        {/* Variant tiles — name + price diff on the parent card. */}
        {isVariantParent && (
          <div className="mt-2 flex flex-wrap gap-1">
            {sortedVariants.slice(0, 4).map((v) => {
              const diff = Number(v.price) - Number(baseVariantPrice);
              return (
                <span
                  key={v.id}
                  className="text-[11px] font-medium text-text bg-hover border border-border px-2 py-0.5"
                >
                  {v.name}{' '}
                  <span className="text-muted">
                    {diff <= 0 ? formatCurrency(Number(v.price)) : `+${formatCurrency(diff)}`}
                  </span>
                </span>
              );
            })}
            {sortedVariants.length > 4 && (
              <span className="text-[11px] font-medium text-muted px-2 py-0.5">
                +{sortedVariants.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

interface PublicMenu {
  categories: Array<{ id: string; name: string; parentId?: string | null }>;
  items: Array<{
    id: string;
    name: string;
    slug?: string;
    description: string | null;
    price: number;
    discountedPrice?: number;
    discountType?: string | null;
    discountValue?: number | null;
    imageUrl: string | null;
    categoryId: string;
    isAvailable: boolean;
    isVariantParent?: boolean;
    variantParentId?: string | null;
    variants?: Array<{ id: string; name: string; price: number; imageUrl?: string | null }>;
  }>;
}

export default function MenuPage() {
  const navigate = useNavigate();
  const { data: menu, isLoading } = useQuery<PublicMenu>({
    queryKey: ['public-menu', getActiveBranchId()],
    queryFn: () => api.getMenu<PublicMenu>(getActiveBranchId()),
  });

  const [active, setActive] = useState<string | null>(null);

  const categories = menu?.categories ?? [];
  const allItems = useMemo(() => menu?.items?.filter((i) => i.isAvailable) ?? [], [menu]);

  // Build parent→children map
  const parentCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, typeof categories>();
    for (const c of categories) {
      if (c.parentId) {
        const existing = map.get(c.parentId) ?? [];
        existing.push(c);
        map.set(c.parentId, existing);
      }
    }
    return map;
  }, [categories]);

  // Get all category IDs under a parent (including the parent itself)
  const getCategoryIds = (catId: string): string[] => {
    const children = childrenOf.get(catId) ?? [];
    return [catId, ...children.map((c) => c.id)];
  };

  // Filtered items based on active category (includes sub-categories)
  const items = useMemo(() => {
    if (!active) return allItems;
    const ids = getCategoryIds(active);
    return allItems.filter((i) => ids.includes(i.categoryId));
  }, [allItems, active, categories]);

  // Group items by category for section display
  const groupedByCategory = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const existing = map.get(item.categoryId) ?? [];
      existing.push(item);
      map.set(item.categoryId, existing);
    }
    return map;
  }, [items]);

  // Discounted items
  const discountedItems = useMemo(() => allItems.filter((i) => i.discountedPrice != null && i.discountedPrice < i.price), [allItems]);

  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'Your Restaurant';

  // Sticky category bar — overflow-x scroller with chevron buttons +
  // edge fades. Buttons hide when their direction is fully scrolled
  // so the bar still looks clean when all tabs fit.
  const catScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateScrollState = useCallback(() => {
    const el = catScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    updateScrollState();
    const el = catScrollRef.current;
    if (!el) return;
    const onResize = () => updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', onResize);
    };
  }, [updateScrollState, parentCategories.length, discountedItems.length]);
  const scrollByAmount = (dir: -1 | 1) => {
    const el = catScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' });
  };

  return (
    <div>
      <SEO
        title={(content as any)?.seoMenuTitle || `${siteName} — Menu`}
        description={(content as any)?.seoMenuDescription || `Explore the full menu at ${siteName}. Fresh ingredients, made-to-order daily.`}
      />
      {/* Header */}
      <section className="relative py-20 px-6 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Discover</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">OUR MENU</h1>
          <p className="text-muted mt-3">Fresh ingredients, made-to-order daily</p>
        </div>
      </section>

      {/* Sticky category nav — chevron buttons + edge fades make it
          obvious there are more tabs off-screen. The chevrons hide
          themselves when scrolled to that edge so a short tab list
          still looks clean. */}
      {categories.length > 0 && (
        <div className="sticky top-16 z-30 bg-bg/95 backdrop-blur border-b border-border">
          <div className="max-w-7xl mx-auto px-6 relative">
            {/* Left chevron */}
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scrollByAmount(-1)}
                aria-label="Scroll categories left"
                className="hidden md:flex absolute left-1 top-1/2 -translate-y-1/2 z-20 w-9 h-9 items-center justify-center bg-bg border border-border text-text hover:bg-accent hover:text-white hover:border-accent transition-colors shadow-lg"
              >
                <Chevron dir="left" />
              </button>
            )}
            {/* Left edge fade */}
            {canScrollLeft && (
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-bg to-transparent z-10" />
            )}

            <div ref={catScrollRef} className="flex gap-1 overflow-x-auto no-scrollbar py-3 scroll-smooth">
              <button
                onClick={() => setActive(null)}
                className={`flex-shrink-0 px-5 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
                  !active ? 'bg-accent text-white' : 'text-muted hover:text-text'
                }`}
              >
                All
              </button>
              {discountedItems.length > 0 && (
                <button
                  onClick={() => setActive('__deals__')}
                  className={`flex-shrink-0 px-5 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
                    active === '__deals__' ? 'bg-accent text-white' : 'text-accent/70 hover:text-accent border border-accent/30'
                  }`}
                >
                  🔥 Deals ({discountedItems.length})
                </button>
              )}
              {parentCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`flex-shrink-0 px-5 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
                    active === c.id ? 'bg-accent text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Right edge fade */}
            {canScrollRight && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-bg to-transparent z-10" />
            )}
            {/* Right chevron */}
            {canScrollRight && (
              <button
                type="button"
                onClick={() => scrollByAmount(1)}
                aria-label="Scroll categories right"
                className="hidden md:flex absolute right-1 top-1/2 -translate-y-1/2 z-20 w-9 h-9 items-center justify-center bg-bg border border-border text-text hover:bg-accent hover:text-white hover:border-accent transition-colors shadow-lg"
              >
                <Chevron dir="right" />
              </button>
            )}
          </div>
        </div>
      )}

      <section className="max-w-7xl mx-auto px-6 py-12">
        {isLoading ? (
          <p className="text-center text-muted py-12">Loading menu...</p>

        ) : active === '__deals__' ? (
          /* ── Deals tab ── */
          <div>
            <h2 className="font-display text-3xl tracking-wider mb-6">TODAY'S DEALS</h2>
            {discountedItems.length === 0 ? (
              <p className="text-muted text-center py-8">No active deals right now.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {discountedItems.map((it) => <ItemCard key={it.id} it={it} navigate={navigate} />)}
                </div>
                <div className="text-center mt-8">
                  <Link to="/deals" className="text-accent text-sm tracking-widest uppercase hover:text-white transition-colors">View All Deals →</Link>
                </div>
              </>
            )}
          </div>

        ) : active ? (
          /* ── Category selected — show sub-category sections ── */
          <div className="space-y-12">
            {(() => {
              const children = childrenOf.get(active) ?? [];
              if (children.length > 0) {
                // Parent with sub-categories: show each sub-cat as a section
                return children.map((sub) => {
                  const subItems = groupedByCategory.get(sub.id);
                  if (!subItems || subItems.length === 0) return null;
                  return (
                    <div key={sub.id}>
                      <h2 className="font-display text-3xl tracking-wider mb-4">{sub.name}</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {subItems.map((it) => <ItemCard key={it.id} it={it} navigate={navigate} />)}
                      </div>
                    </div>
                  );
                });
              }
              // Leaf category (no children) — show grid directly
              return items.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {items.map((it) => <ItemCard key={it.id} it={it} navigate={navigate} />)}
                </div>
              ) : (
                <p className="text-muted text-center py-8">No items in this category.</p>
              );
            })()}
          </div>

        ) : (
          /* ── All categories — carousel per parent ── */
          <div className="space-y-12">
            {parentCategories.map((parent) => {
              // Collect items from parent + all its children
              const ids = getCategoryIds(parent.id);
              const parentItems = allItems.filter((i) => ids.includes(i.categoryId));
              if (parentItems.length === 0) return null;
              return (
                <div key={parent.id}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-3xl tracking-wider">{parent.name}</h2>
                    {parentItems.length > 6 && (
                      <button onClick={() => setActive(parent.id)} className="text-accent text-xs tracking-widest uppercase hover:text-white transition-colors">View All →</button>
                    )}
                  </div>
                  <MenuCarousel items={parentItems.slice(0, 12)} onItemClick={(id) => navigate(`/menu/${id}`)} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
