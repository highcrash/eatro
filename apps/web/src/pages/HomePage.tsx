import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useBranding, useWebsiteContent, getActiveBranchId } from '../lib/cms';
import { api } from '../lib/api';
import { formatCurrency } from '@restora/utils';
import MenuCarousel from '../components/MenuCarousel';
import SEO from '../components/SEO';
import { useMemo, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

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

interface RecommendedItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discountedPrice?: number;
  imageUrl: string | null;
  categoryId: string;
  categoryName?: string;
}

interface Review {
  id: string;
  customerName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function resolveLogoUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const navigate = useNavigate();
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();

  const { data: menu } = useQuery<PublicMenu>({
    queryKey: ['public-menu', getActiveBranchId()],
    queryFn: () => api.getMenu<PublicMenu>(getActiveBranchId()),
  });

  const { data: recommended } = useQuery<RecommendedItem[]>({
    queryKey: ['recommended', getActiveBranchId()],
    queryFn: () => api.getJson<RecommendedItem[]>(`/public/menu/${getActiveBranchId()}/recommended`),
  });

  const { data: reviews } = useQuery<Review[]>({
    queryKey: ['reviews', getActiveBranchId()],
    queryFn: () => api.getJson<Review[]>(`/public/reviews/${getActiveBranchId()}`),
    enabled: content?.showReviews !== false,
  });

  const logo = resolveLogoUrl(branding?.logoUrl);
  const brandName = branding?.name ?? 'Restora';

  const galleryImages: string[] = useMemo(() => {
    if (!content?.galleryImages) return [];
    try { return JSON.parse(content.galleryImages); } catch { return []; }
  }, [content?.galleryImages]);

  const [lightbox, setLightbox] = useState<string | null>(null);

  const categories = menu?.categories ?? [];
  const items = menu?.items?.filter((i) => i.isAvailable) ?? [];

  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';

  return (
    <div>
      <SEO
        title={(content as any)?.seoHomeTitle || `${siteName} — Where Flavor Takes The Lead`}
        description={(content as any)?.seoHomeDescription || `${siteName} — Fine dining restaurant with fusion cuisine. View our menu, book a table.`}
        keywords={(content as any)?.seoHomeKeywords || 'restaurant, fine dining, reservation, menu'}
        image={(content as any)?.seoOgImage || content?.heroImageUrl || undefined}
      />
      {/* ================================================================ */}
      {/*  1. HERO                                                          */}
      {/* ================================================================ */}
      <section className="relative h-screen min-h-[600px] flex items-center justify-center overflow-hidden">
        {/* Video / Image background */}
        {content?.heroVideoUrl ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            src={content.heroVideoUrl}
          />
        ) : content?.heroImageUrl ? (
          <img
            src={content.heroImageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0D0D0D] to-[#1a1a1a]" />
        )}

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          {logo && (
            <img src={logo} alt="" className="h-16 w-auto mx-auto mb-6 object-contain" />
          )}
          <h1 className="font-display text-6xl md:text-8xl lg:text-9xl tracking-wider text-white leading-none">
            {content?.heroTitle ?? brandName}
          </h1>
          {(content?.heroSubtitle || branding?.websiteTagline) && (
            <p className="font-serif italic text-lg md:text-xl text-white/70 mt-4 max-w-2xl mx-auto">
              {content?.heroSubtitle ?? branding?.websiteTagline}
            </p>
          )}
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/menu"
              className="bg-btn hover:opacity-90 text-white font-display text-lg tracking-wider px-8 py-3 transition-opacity"
            >
              {content?.heroCtaText ?? 'Explore Menu'}
            </Link>
            {content?.showReservation !== false && (
              <Link
                to="/reservation"
                className="border border-white/30 hover:border-white/60 text-white font-display text-lg tracking-wider px-8 py-3 transition-colors"
              >
                Book a Table
              </Link>
            )}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/40 animate-bounce">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ================================================================ */}
      {/*  2. CHEF'S SPECIALS (Recommended)                                 */}
      {/* ================================================================ */}
      {recommended && recommended.length > 0 && (
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="font-serif italic text-accent text-center mb-2">From the Kitchen</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
              CHEF&apos;S SPECIALS
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {recommended.slice(0, 3).map((item) => {
                const hasDiscount = item.discountedPrice != null && item.discountedPrice < item.price;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/menu/${(item as any).slug || item.id}`)}
                    className="relative aspect-[3/4] overflow-hidden group text-left"
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-hover" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      {item.categoryName && (
                        <span className="text-xs font-semibold uppercase tracking-widest text-accent mb-2 block">
                          {item.categoryName}
                        </span>
                      )}
                      <h3 className="font-display text-3xl tracking-wider text-white">{item.name}</h3>
                      <div className="mt-2">
                        {hasDiscount ? (
                          <div className="flex items-baseline gap-2">
                            <span className="text-accent font-bold text-xl">{formatCurrency(item.discountedPrice!)}</span>
                            <span className="text-white/50 text-sm line-through">{formatCurrency(Number(item.price))}</span>
                          </div>
                        ) : (
                          <span className="text-accent font-bold text-xl">{formatCurrency(Number(item.price))}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  3. MENU PREVIEW                                                  */}
      {/* ================================================================ */}
      {categories.length > 0 && items.length > 0 && (
        <section className="py-20 px-6 bg-card relative overflow-hidden">
          {(content as any)?.menuSectionBg && (
            <>
              <img src={(content as any).menuSectionBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/80" />
            </>
          )}
          <div className="max-w-7xl mx-auto relative">
            <p className="font-serif italic text-accent text-center mb-2">Discover</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
              OUR MENU
            </h2>

            {categories.slice(0, 5).map((cat) => {
              const catItems = items
                .filter((i) => i.categoryId === cat.id)
                .slice(0, 10);
              if (catItems.length === 0) return null;
              return (
                <div key={cat.id} className="mb-10">
                  <h3 className="font-display text-2xl tracking-wider text-text mb-4">{cat.name}</h3>
                  <MenuCarousel
                    items={catItems}
                    onItemClick={(id) => navigate(`/menu/${id}`)}
                  />
                </div>
              );
            })}

            <div className="text-center mt-8">
              <Link
                to="/menu"
                className="inline-block border border-border hover:border-accent text-text hover:text-accent font-display text-lg tracking-wider px-8 py-3 transition-colors"
              >
                View Full Menu
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  4. ABOUT                                                         */}
      {/* ================================================================ */}
      {(content?.aboutPoint1 || content?.aboutBody) && (
        <section
          className="relative py-20 px-6"
          style={content?.aboutSectionBg ? {
            backgroundImage: `url(${content.aboutSectionBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined}
        >
          {content?.aboutSectionBg && (
            <div className="absolute inset-0 bg-black/80" />
          )}
          <div className="relative max-w-7xl mx-auto">
            <p className="font-serif italic text-accent text-center mb-2">Our Story</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
              {content?.aboutTitle ?? 'ABOUT US'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              {[content?.aboutPoint1, content?.aboutPoint2, content?.aboutPoint3, content?.aboutPoint4]
                .map((point, i) => {
                  if (!point) return null;
                  return (
                    <div key={i} className="glass p-6">
                      <span className="font-display text-5xl text-accent/30">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <p className="text-sm text-text/80 mt-3 leading-relaxed">{point}</p>
                    </div>
                  );
                })}
            </div>

            {content?.openingHours && (
              <div className="text-center">
                <p className="font-display text-2xl tracking-wider mb-3">Opening Hours</p>
                <p className="text-muted whitespace-pre-line text-sm">{content.openingHours}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  5. BANNER                                                        */}
      {/* ================================================================ */}
      {content?.bannerText && (
        <section
          className="relative py-24 px-6"
          style={content.bannerBg ? {
            backgroundImage: `url(${content.bannerBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined}
        >
          {content.bannerBg && <div className="absolute inset-0 bg-black/60" />}
          <div className="relative max-w-5xl mx-auto text-center">
            <p className="font-display text-4xl md:text-6xl lg:text-7xl tracking-wider text-white leading-tight">
              {content.bannerText}
            </p>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  6. GALLERY                                                       */}
      {/* ================================================================ */}
      {content?.showGallery && galleryImages.length > 0 && (
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <p className="font-serif italic text-accent text-center mb-2">Visual Journey</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
              GALLERY
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {galleryImages.map((src, i) => (
                <button key={i} className="aspect-square overflow-hidden cursor-pointer" onClick={() => setLightbox(src)}>
                  <img
                    src={src}
                    alt=""
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  7. REVIEWS                                                       */}
      {/* ================================================================ */}
      {content?.showReviews !== false && reviews && reviews.length > 0 && (
        <section className="py-20 px-6 bg-card relative overflow-hidden">
          {(content as any)?.reviewsSectionBg && (
            <>
              <img src={(content as any).reviewsSectionBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/80" />
            </>
          )}
          <div className="max-w-7xl mx-auto relative">
            <p className="font-serif italic text-accent text-center mb-2">What They Say</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
              REVIEWS
            </h2>
            <div className="flex gap-6 overflow-x-auto no-scrollbar pb-4">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="flex-shrink-0 w-80 glass p-6"
                >
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <svg
                        key={i}
                        className={`w-4 h-4 ${i < review.rating ? 'text-accent' : 'text-border'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  {review.comment && (
                    <p className="text-sm text-text/80 leading-relaxed mb-4 line-clamp-4">
                      &ldquo;{review.comment}&rdquo;
                    </p>
                  )}
                  <p className="text-xs font-semibold text-accent uppercase tracking-wider">
                    {review.customerName}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  8. RESERVATION CTA                                               */}
      {/* ================================================================ */}
      {content?.showReservation !== false && (
        <section className="py-20 px-6 relative overflow-hidden">
          {(content as any)?.reservationSectionBg && (
            <>
              <img src={(content as any).reservationSectionBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/80" />
            </>
          )}
          <div className="max-w-3xl mx-auto text-center relative">
            <p className="font-serif italic text-accent mb-2">Don&apos;t Miss Out</p>
            <h2 className="font-display text-5xl md:text-6xl tracking-wider mb-6">
              RESERVE YOUR TABLE
            </h2>
            <p className="text-muted mb-8 max-w-lg mx-auto">
              Secure your spot for an unforgettable dining experience. Book now and let us take care of the rest.
            </p>
            <Link
              to="/reservation"
              className="inline-block bg-btn hover:opacity-90 text-white font-display text-lg tracking-wider px-10 py-4 transition-opacity"
            >
              Book Now
            </Link>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/*  9. CONTACT                                                       */}
      {/* ================================================================ */}
      <section className="py-20 px-6 bg-card border-t border-border relative overflow-hidden">
        {(content as any)?.contactSectionBg && (
          <>
            <img src={(content as any).contactSectionBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/80" />
          </>
        )}
        <div className="max-w-7xl mx-auto relative">
          <p className="font-serif italic text-accent text-center mb-2">Get in Touch</p>
          <h2 className="font-display text-5xl md:text-6xl tracking-wider text-center mb-12">
            FIND US
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Info */}
            <div className="space-y-6">
              {branding?.address && (
                <div>
                  <p className="font-display text-lg tracking-wider mb-1">Address</p>
                  <p className="text-muted text-sm">{branding.address}</p>
                </div>
              )}
              {branding?.phone && (
                <div>
                  <p className="font-display text-lg tracking-wider mb-1">Phone</p>
                  <a href={`tel:${branding.phone}`} className="text-accent text-sm hover:underline">
                    {branding.phone}
                  </a>
                </div>
              )}
              {branding?.email && (
                <div>
                  <p className="font-display text-lg tracking-wider mb-1">Email</p>
                  <a href={`mailto:${branding.email}`} className="text-accent text-sm hover:underline">
                    {branding.email}
                  </a>
                </div>
              )}
              {(branding?.facebookUrl || branding?.instagramUrl) && (
                <div>
                  <p className="font-display text-lg tracking-wider mb-2">Social</p>
                  <div className="flex gap-3">
                    {branding?.facebookUrl && (
                      <a
                        href={branding.facebookUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted hover:text-accent text-sm transition-colors"
                      >
                        Facebook
                      </a>
                    )}
                    {branding?.instagramUrl && (
                      <a
                        href={branding.instagramUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted hover:text-accent text-sm transition-colors"
                      >
                        Instagram
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Map */}
            <div className="aspect-video md:aspect-auto min-h-[300px] bg-hover border border-border overflow-hidden">
              {content?.mapEmbedUrl ? (
                <iframe
                  src={content.mapEmbedUrl}
                  title="Map"
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted">
                  <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Gallery Lightbox Modal */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-6 right-6 text-white/60 hover:text-white text-4xl font-light transition-colors z-10"
          >
            &times;
          </button>
          {/* Prev/Next arrows */}
          {galleryImages.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-5xl font-light transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  const idx = galleryImages.indexOf(lightbox);
                  setLightbox(galleryImages[(idx - 1 + galleryImages.length) % galleryImages.length]);
                }}
              >
                &#8249;
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-5xl font-light transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  const idx = galleryImages.indexOf(lightbox);
                  setLightbox(galleryImages[(idx + 1) % galleryImages.length]);
                }}
              >
                &#8250;
              </button>
            </>
          )}
          <img
            src={lightbox}
            alt=""
            className="max-w-full max-h-[90vh] object-contain cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
