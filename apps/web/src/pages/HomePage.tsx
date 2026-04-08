import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useBranding, useWebsiteContent, DEFAULT_BRANCH } from '../lib/cms';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';

interface PublicMenu {
  categories: Array<{ id: string; name: string }>;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    imageUrl: string | null;
    categoryId: string;
    isAvailable: boolean;
  }>;
}

export default function HomePage() {
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();
  const { data: menu } = useQuery<PublicMenu>({
    queryKey: ['public-menu', DEFAULT_BRANCH],
    queryFn: () => api.getMenu<PublicMenu>(DEFAULT_BRANCH),
  });

  const featuredCategoryIds = content?.featuredCategoryIds ?? [];
  const featured = (menu?.categories ?? [])
    .filter((c) => featuredCategoryIds.length === 0 || featuredCategoryIds.includes(c.id))
    .slice(0, 3);

  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-orange-50 via-white to-orange-50 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight">
              {content?.heroTitle ?? 'Welcome'}
            </h1>
            {(content?.heroSubtitle || branding?.websiteTagline) && (
              <p className="mt-4 text-lg text-gray-600">
                {content?.heroSubtitle ?? branding?.websiteTagline}
              </p>
            )}
            <div className="mt-8 flex gap-3">
              <Link
                to="/menu"
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-3 rounded-lg transition-colors"
              >
                {content?.heroCtaText ?? 'View Menu'}
              </Link>
              <Link
                to="/contact"
                className="border-2 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white font-bold px-6 py-3 rounded-lg transition-colors"
              >
                Visit Us
              </Link>
            </div>
          </div>
          <div className="aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden shadow-xl relative">
            {content?.heroImageUrl ? (
              <img
                src={content.heroImageUrl}
                alt=""
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
              className="w-full h-full items-center justify-center text-7xl absolute inset-0"
              style={{ display: content?.heroImageUrl ? 'none' : 'flex' }}
            >
              🍽️
            </div>
          </div>
        </div>
      </section>

      {/* Featured */}
      {featured.length > 0 && menu && (
        <section className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-3xl font-extrabold text-center mb-2">Featured</h2>
          <p className="text-center text-gray-600 mb-10">A taste of what's on our menu</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {featured.map((cat) => {
              const items = menu.items.filter((i) => i.categoryId === cat.id && i.isAvailable).slice(0, 4);
              return (
                <div key={cat.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
                  <h3 className="font-extrabold text-xl mb-3">{cat.name}</h3>
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li key={it.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-800">{it.name}</span>
                        <span className="font-bold text-gray-900">{formatCurrency(Number(it.price))}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/menu" className="mt-4 inline-block text-orange-500 font-semibold text-sm hover:underline">
                    View all →
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* About teaser */}
      {content?.aboutBody && (
        <section className="bg-gray-50 border-y border-gray-200">
          <div className="max-w-4xl mx-auto px-6 py-16 text-center">
            <h2 className="text-3xl font-extrabold mb-4">{content.aboutTitle}</h2>
            <p className="text-gray-600 leading-relaxed line-clamp-4">{content.aboutBody}</p>
            <Link to="/about" className="mt-6 inline-block text-orange-500 font-semibold hover:underline">
              Read more →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
