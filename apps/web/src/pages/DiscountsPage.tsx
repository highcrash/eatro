import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getActiveBranchId, useBranding, useWebsiteContent } from '../lib/cms';
import { formatCurrency } from '@restora/utils';
import SEO from '../components/SEO';

interface Item {
  id: string; name: string; slug?: string; price: number;
  discountedPrice: number; discountType: string; discountValue: number;
  discountEndDate?: string; discountApplicableDays?: string[] | null;
  imageUrl: string | null; description: string | null;
  category?: { name: string };
}

export default function DiscountsPage() {
  const navigate = useNavigate();
  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'Your Restaurant';

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ['discounted', getActiveBranchId()],
    queryFn: () => api.getJson<Item[]>(`/public/menu/${getActiveBranchId()}/discounted`),
  });

  return (
    <div>
      <SEO title={`${siteName} — Today's Deals`} description={`Special discounts and offers at ${siteName}. Limited time deals on our finest dishes.`} />

      <section className="py-24 px-6 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Limited Time</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">TODAY'S DEALS</h1>
          <p className="text-muted mt-3 max-w-lg mx-auto">Don't miss out on these special offers — available for a limited time only</p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <p className="text-muted text-center py-12">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-muted text-center py-12">No active deals right now. Check back soon!</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/menu/${item.slug || item.id}`)}
                  className="bg-card border border-border hover:border-accent/40 transition-colors text-left group relative"
                >
                  {/* Discount badge */}
                  <div className="absolute top-3 right-3 z-10 bg-accent text-white text-xs font-bold px-2 py-1">
                    -{Math.round((1 - item.discountedPrice / Number(item.price)) * 100)}%
                  </div>

                  <div className="aspect-square overflow-hidden bg-hover">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain p-6 group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-muted/20">🍽️</div>
                    )}
                  </div>
                  <div className="p-5">
                    {item.category && <p className="text-muted text-xs tracking-widest uppercase mb-1">{item.category.name}</p>}
                    <h3 className="text-text font-semibold text-lg mb-2">{item.name}</h3>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="font-display text-xl text-accent">{formatCurrency(item.discountedPrice)}</span>
                      <span className="text-muted text-sm line-through">{formatCurrency(Number(item.price))}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        const tags: { label: string; cls: string }[] = [];
                        if (item.discountApplicableDays && item.discountApplicableDays.length > 0 && item.discountApplicableDays.length < 7) {
                          const days = item.discountApplicableDays.map(d => d.slice(0,3)).join(', ');
                          tags.push({ label: `${days} Only`, cls: 'bg-accent/20 text-accent' });
                        }
                        if (item.discountEndDate) {
                          const end = new Date(item.discountEndDate);
                          const now = new Date();
                          const diffMs = end.getTime() - now.getTime();
                          const diffDays = Math.floor(diffMs / 86400000);
                          const diffHours = Math.floor((diffMs % 86400000) / 3600000);
                          tags.push({ label: `Valid ${end.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`, cls: 'bg-border text-muted' });
                          if (diffDays <= 7 && diffMs > 0) {
                            tags.push({ label: diffDays > 0 ? `${diffDays}D ${diffHours}H left` : `${diffHours}H left`, cls: 'bg-accent text-white' });
                          }
                        }
                        if (tags.length === 0) tags.push({ label: 'Limited Offer', cls: 'bg-accent/20 text-accent' });
                        return tags.map((t, i) => <span key={i} className={`${t.cls} text-[10px] font-bold px-2 py-0.5`}>{t.label}</span>);
                      })()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
