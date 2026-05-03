import { useRef } from 'react';
import { formatCurrency } from '@restora/utils';

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  discountedPrice?: number;
  imageUrl: string | null;
  categoryId?: string;
  /** Set on variant parent shells; the carousel falls back to the
   *  cheapest variant's price + a "From" prefix when the parent's
   *  own price is 0. */
  isVariantParent?: boolean;
  variants?: Array<{ id: string; name: string; price: number }>;
}

interface MenuCarouselProps {
  items: MenuItem[];
  onItemClick: (id: string) => void;
}

export default function MenuCarousel({ items, onItemClick }: MenuCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 280;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  return (
    <div className="relative group">
      {/* Left arrow */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-card border border-border flex items-center justify-center text-text hover:bg-hover transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Scroll left"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Right arrow */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-card border border-border flex items-center justify-center text-text hover:bg-hover transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Scroll right"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar px-1 py-2"
      >
        {items.map((item) => {
          const hasDiscount = item.discountedPrice != null && item.discountedPrice < item.price;
          // Variant parents carry price=0 because the variants hold
          // the actual price. Fall back to the cheapest variant's
          // price + a "From" prefix so the carousel never reads ৳0.
          const variants = Array.isArray(item.variants) ? item.variants : [];
          const cheapestVariantPrice = variants.length > 0
            ? variants.reduce((min, v) => Math.min(min, Number(v.price)), Number(variants[0].price))
            : 0;
          const isParentWithVariants = !!item.isVariantParent && variants.length > 0;
          const displayPrice = isParentWithVariants && Number(item.price) === 0
            ? cheapestVariantPrice
            : Number(item.price);
          return (
            <button
              key={item.id}
              onClick={() => onItemClick((item as any).slug || item.id)}
              className="flex-shrink-0 w-32 sm:w-56 bg-card border border-border hover:border-accent/40 transition-colors text-left group/card"
            >
              <div className="aspect-square bg-hover relative overflow-hidden">
                {hasDiscount && (
                  <span className="absolute top-2 right-2 z-10 bg-accent text-white text-xs font-bold px-2 py-1">
                    {item.discountedPrice != null ? `-${Math.round((1 - item.discountedPrice / item.price) * 100)}%` : 'SALE'}
                  </span>
                )}
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl text-muted">
                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-text truncate">{item.name}</p>
                <div className="flex items-center justify-between mt-1">
                  {hasDiscount ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-accent font-bold text-sm">{formatCurrency(item.discountedPrice!)}</span>
                      <span className="text-muted text-xs line-through">{formatCurrency(displayPrice)}</span>
                    </div>
                  ) : (
                    <span className="text-accent font-bold text-sm">
                      {isParentWithVariants && <span className="text-muted text-xs font-normal mr-1">From</span>}
                      {formatCurrency(displayPrice)}
                    </span>
                  )}
                  <svg className="w-4 h-4 text-muted group-hover/card:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
