import { useNavigate } from 'react-router-dom';

import type { MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { useCartStore } from '../store/cart.store';

/**
 * Horizontal-scroll merchandising strip used by both Top Selling
 * and New Items sections at the top of the QR menu page. Card shape
 * matches the website's MenuCarousel for visual consistency
 * (square image + name + price line). Tap card → navigate to
 * /item/:id (handles addons + variants there). Quick-add (+) is
 * skipped — the homepage strip is for browsing/discovery, not
 * one-tap add; reduces accidental adds while scrolling horizontally
 * on a phone.
 *
 * Hides itself entirely when items.length === 0 — no empty heading
 * dangling on a fresh branch.
 */
interface Props {
  label: string;
  items: MenuItem[];
}

export default function HomepageItemStrip({ label, items }: Props) {
  const navigate = useNavigate();
  const cartHasItems = useCartStore((s) => s.items.length > 0);
  if (!items.length) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between px-5 mb-2">
        <p className="font-body text-xs text-[#888] tracking-widest uppercase">{label}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto px-5 pb-1 snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
        {items.map((item) => {
          const basePrice = Number(item.price);
          // Variant parents store price=0 because the variants hold
          // the actual price. Fall back to the cheapest variant + a
          // "From" prefix so the strip never reads ৳0. Mirrors the
          // FoodCard logic on the main grid.
          const variants = Array.isArray((item as any).variants)
            ? ((item as any).variants as Array<{ price: number }>)
            : [];
          const isVariantParent = !!(item as any).isVariantParent && variants.length > 0;
          const cheapestVariantPrice = isVariantParent
            ? variants.reduce((min, v) => Math.min(min, Number(v.price)), Number(variants[0].price))
            : 0;
          const showFromPrefix = isVariantParent && cheapestVariantPrice > basePrice;
          const displayPrice = isVariantParent && basePrice === 0 ? cheapestVariantPrice : basePrice;
          const rawDiscounted = (item as any).discountedPrice;
          const hasDiscount = rawDiscounted != null
            && Number(rawDiscounted) < basePrice
            && basePrice > 0
            && !isVariantParent;
          const discountedPrice = hasDiscount ? Number(rawDiscounted) : null;
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/item/${item.id}`)}
              className="flex-shrink-0 w-32 bg-[#1A1A1A] border border-[#2A2A2A] overflow-hidden text-left snap-start"
            >
              <div className="aspect-square bg-[#111] relative overflow-hidden">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">🍽️</div>
                )}
                {hasDiscount && (
                  <span className="absolute top-1.5 left-1.5 bg-[#D62B2B] text-white text-[9px] font-body font-bold px-1.5 py-0.5 tracking-widest">
                    -{Math.round((1 - discountedPrice! / basePrice) * 100)}%
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="font-body font-medium text-[11px] text-white leading-tight line-clamp-2 min-h-[28px]">{item.name}</p>
                {hasDiscount ? (
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-display text-xs text-[#C8FF00]">{formatCurrency(discountedPrice!)}</span>
                    <span className="font-body text-[10px] text-[#666] line-through">{formatCurrency(basePrice)}</span>
                  </div>
                ) : displayPrice > 0 ? (
                  <p className="font-display text-xs text-white mt-1">
                    {showFromPrefix && <span className="text-[9px] text-[#888] font-body font-normal mr-1">From</span>}
                    {formatCurrency(displayPrice)}
                  </p>
                ) : (
                  // Belt-and-suspenders: a variant parent that slipped
                  // through with no usable price reads "BDT 0.00" which
                  // looks like a billing bug. Hide the price line
                  // entirely — the backend filter is the real fix; this
                  // is just so a regression never resurfaces the issue.
                  <p className="font-body text-[10px] text-[#888] mt-1">See options</p>
                )}
              </div>
            </button>
          );
        })}
        {/* Spacer at the right edge so the last card isn't flush
            against the cart button when items overflow. */}
        {cartHasItems && <div className="w-2 flex-shrink-0" />}
      </div>
    </div>
  );
}
