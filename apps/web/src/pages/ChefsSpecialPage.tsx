import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getActiveBranchId, useBranding, useWebsiteContent } from '../lib/cms';
import { formatCurrency } from '@restora/utils';
import SEO from '../components/SEO';

interface Item {
  id: string; name: string; slug?: string; price: number;
  discountedPrice?: number; discountType?: string; discountValue?: number;
  imageUrl: string | null; description: string | null;
  category?: { name: string };
}

export default function ChefsSpecialPage() {
  const navigate = useNavigate();
  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ['recommended', getActiveBranchId()],
    queryFn: () => api.getJson<Item[]>(`/public/menu/${getActiveBranchId()}/recommended`),
  });

  return (
    <div>
      <SEO title={`${siteName} — Chef's Special`} description={`Hand-picked dishes by our chef at ${siteName}.`} />

      <section className="py-24 px-6 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Hand-Picked by Our Chef</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">CHEF'S SPECIAL</h1>
          <p className="text-muted mt-3 max-w-lg mx-auto">Our most loved and recommended dishes, curated for an unforgettable experience</p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <p className="text-muted text-center py-12">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-muted text-center py-12">No chef's specials at the moment.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((item) => {
                const hasDiscount = item.discountedPrice != null && item.discountedPrice < item.price;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/menu/${item.slug || item.id}`)}
                    className="bg-card border border-border hover:border-accent/40 transition-colors text-left group"
                  >
                    <div className="aspect-square overflow-hidden bg-hover relative">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl text-muted/20">🍽️</div>
                      )}
                      {hasDiscount && item.discountType === 'PERCENTAGE' && item.discountValue && (
                        <span className="absolute top-3 right-3 bg-accent text-white text-xs font-bold px-2 py-1">{item.discountValue}% OFF</span>
                      )}
                    </div>
                    <div className="p-5">
                      {item.category && <p className="text-muted text-xs tracking-widest uppercase mb-1">{item.category.name}</p>}
                      <h3 className="text-text font-semibold text-lg mb-2">{item.name}</h3>
                      {item.description && <p className="text-muted text-sm line-clamp-2 mb-3">{item.description}</p>}
                      <div className="flex items-baseline gap-2">
                        {hasDiscount ? (
                          <>
                            <span className="font-display text-xl text-accent">{formatCurrency(item.discountedPrice!)}</span>
                            <span className="text-muted text-sm line-through">{formatCurrency(Number(item.price))}</span>
                          </>
                        ) : (
                          <span className="font-display text-xl text-accent">{formatCurrency(Number(item.price))}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
