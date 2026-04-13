import { useWebsiteContent, useBranding } from '../lib/cms';
import SEO from '../components/SEO';

export default function AboutPage() {
  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';

  const points = [content?.aboutPoint1, content?.aboutPoint2, content?.aboutPoint3, content?.aboutPoint4];
  const hasPoints = points.some(Boolean);

  return (
    <div>
      <SEO
        title={(content as any)?.seoAboutTitle || `About Us — ${siteName}`}
        description={(content as any)?.seoAboutDescription || `Learn about ${siteName}. Our story, values, and commitment to culinary excellence.`}
      />
      {/* Hero header */}
      <section
        className="relative py-24 px-6 bg-card border-b border-border"
        style={content?.aboutSectionBg ? {
          backgroundImage: `url(${content.aboutSectionBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : undefined}
      >
        {content?.aboutSectionBg && <div className="absolute inset-0 bg-black/70" />}
        <div className="relative max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Our Story</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">
            {content?.aboutTitle ?? 'ABOUT US'}
          </h1>
          {branding?.websiteTagline && (
            <p className="font-serif italic text-muted mt-4 max-w-xl mx-auto">
              &ldquo;{branding.websiteTagline}&rdquo;
            </p>
          )}
        </div>
      </section>

      {/* About body */}
      {content?.aboutBody && (
        <section className="max-w-4xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            {content.aboutImageUrl && (
              <div className="aspect-square bg-hover border border-border overflow-hidden">
                <img
                  src={content.aboutImageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
            )}
            <div className={content.aboutImageUrl ? '' : 'md:col-span-2 text-center'}>
              <p className="text-muted leading-relaxed whitespace-pre-line">
                {content.aboutBody}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 4 Numbered cards */}
      {hasPoints && (
        <section className="py-16 px-6 bg-card border-t border-border">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {points.map((point, i) => {
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
          </div>
        </section>
      )}

      {/* Opening hours */}
      {content?.openingHours && (
        <section className="py-16 px-6">
          <div className="max-w-md mx-auto text-center glass p-8">
            <p className="font-display text-2xl tracking-wider mb-4">Opening Hours</p>
            <p className="text-muted whitespace-pre-line text-sm leading-relaxed">{content.openingHours}</p>
          </div>
        </section>
      )}
    </div>
  );
}
