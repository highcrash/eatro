import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { DEFAULT_BRANCH } from '../lib/cms';
import { formatCurrency } from '@restora/utils';

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
  const { data: menu, isLoading } = useQuery<PublicMenu>({
    queryKey: ['public-menu', DEFAULT_BRANCH],
    queryFn: () => api.getMenu<PublicMenu>(DEFAULT_BRANCH),
  });

  const [active, setActive] = useState<string | null>(null);

  const categories = menu?.categories ?? [];
  const items = useMemo(() => {
    const all = menu?.items?.filter((i) => i.isAvailable) ?? [];
    if (!active) return all;
    return all.filter((i) => i.categoryId === active);
  }, [menu, active]);

  return (
    <div>
      <section className="bg-gradient-to-br from-orange-50 to-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900">Our Menu</h1>
          <p className="text-gray-600 mt-2">Fresh ingredients, made-to-order daily</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-10">
        {/* Category filter pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8 justify-center">
            <button
              onClick={() => setActive(null)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                !active ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                  active === c.id ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <p className="text-center text-gray-500 py-12">Loading menu…</p>
        ) : items.length === 0 ? (
          <p className="text-center text-gray-500 py-12">No items available right now.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((it) => {
              const hasDiscount = it.discountedPrice != null && it.discountedPrice < it.price;
              return (
                <div key={it.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-[4/3] bg-gray-100 relative">
                    {it.imageUrl ? (
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const img = e.currentTarget;
                          img.style.display = 'none';
                          const next = img.nextElementSibling as HTMLDivElement | null;
                          if (next) next.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className="w-full h-full items-center justify-center text-5xl absolute inset-0"
                      style={{ display: it.imageUrl ? 'none' : 'flex' }}
                    >
                      🍽️
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-lg text-gray-900">{it.name}</h3>
                    {it.description && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{it.description}</p>
                    )}
                    <div className="mt-3 flex items-baseline gap-2">
                      {hasDiscount ? (
                        <>
                          <span className="text-xl font-extrabold text-orange-500">{formatCurrency(it.discountedPrice!)}</span>
                          <span className="text-sm text-gray-400 line-through">{formatCurrency(Number(it.price))}</span>
                        </>
                      ) : (
                        <span className="text-xl font-extrabold text-gray-900">{formatCurrency(Number(it.price))}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
