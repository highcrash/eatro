import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getActiveBranchId, useWebsiteContent, useBranding } from '../lib/cms';
import { formatCurrency } from '@restora/utils';
import SEO from '../components/SEO';
import MenuCarousel from '../components/MenuCarousel';

interface PublicMenu {
  categories: Array<{ id: string; name: string }>;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    discountedPrice?: number;
    imageUrl: string | null;
    categoryId: string;
    isAvailable: boolean;
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
  const items = useMemo(() => {
    const all = menu?.items?.filter((i) => i.isAvailable) ?? [];
    if (!active) return all;
    return all.filter((i) => i.categoryId === active);
  }, [menu, active]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const existing = map.get(item.categoryId) ?? [];
      existing.push(item);
      map.set(item.categoryId, existing);
    }
    return map;
  }, [items]);

  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';

  return (
    <div>
      <SEO
        title={(content as any)?.seoMenuTitle || `Menu — ${siteName}`}
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

      {/* Sticky category nav */}
      {categories.length > 0 && (
        <div className="sticky top-16 z-30 bg-bg/95 backdrop-blur border-b border-border">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex gap-1 overflow-x-auto no-scrollbar py-3">
              <button
                onClick={() => setActive(null)}
                className={`flex-shrink-0 px-5 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
                  !active ? 'bg-accent text-white' : 'text-muted hover:text-text'
                }`}
              >
                All
              </button>
              {categories.map((c) => (
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
          </div>
        </div>
      )}

      <section className="max-w-7xl mx-auto px-6 py-12">
        {isLoading ? (
          <p className="text-center text-muted py-12">Loading menu...</p>
        ) : items.length === 0 ? (
          <p className="text-center text-muted py-12">No items available right now.</p>
        ) : active ? (
          /* Grid view when a single category is selected */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {items.map((it) => {
              const hasDiscount = it.discountedPrice != null && it.discountedPrice < it.price;
              return (
                <button
                  key={it.id}
                  onClick={() => navigate(`/menu/${(it as any).slug || it.id}`)}
                  className="bg-card border border-border hover:border-accent/40 transition-colors text-left group"
                >
                  <div className="aspect-square bg-hover relative overflow-hidden">
                    {it.imageUrl ? (
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted">
                        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-text">{it.name}</h3>
                    {it.description && (
                      <p className="text-xs text-muted mt-1 line-clamp-2">{it.description}</p>
                    )}
                    <div className="mt-3">
                      {hasDiscount ? (
                        <div className="flex items-baseline gap-2">
                          <span className="text-accent font-bold">{formatCurrency(it.discountedPrice!)}</span>
                          <span className="text-muted text-xs line-through">{formatCurrency(Number(it.price))}</span>
                        </div>
                      ) : (
                        <span className="text-accent font-bold">{formatCurrency(Number(it.price))}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Carousel view per category when "All" is selected */
          <div className="space-y-12">
            {categories.map((cat) => {
              const catItems = groupedByCategory.get(cat.id);
              if (!catItems || catItems.length === 0) return null;
              return (
                <div key={cat.id}>
                  <h2 className="font-display text-3xl tracking-wider mb-4">{cat.name}</h2>
                  <MenuCarousel
                    items={catItems}
                    onItemClick={(id) => navigate(`/menu/${id}`)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
