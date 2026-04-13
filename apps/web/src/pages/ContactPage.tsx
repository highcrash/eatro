import { useBranding, useWebsiteContent } from '../lib/cms';
import SEO from '../components/SEO';

export default function ContactPage() {
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();
  const siteName = (content as any)?.seoSiteName || branding?.name || 'EATRO';

  return (
    <div>
      <SEO
        title={(content as any)?.seoContactTitle || `Contact — ${siteName}`}
        description={(content as any)?.seoContactDescription || `Visit ${siteName}. Find our address, phone number, and opening hours.`}
      />
      {/* Hero header */}
      <section className="py-24 px-6 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Get in Touch</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">VISIT US</h1>
          <p className="text-muted mt-3">We&apos;d love to see you</p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Contact info */}
        <div className="space-y-8">
          {content?.contactNote && (
            <p className="text-muted whitespace-pre-line leading-relaxed">{content.contactNote}</p>
          )}

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
              <p className="font-display text-lg tracking-wider mb-3">Follow Us</p>
              <div className="flex gap-3">
                {branding?.facebookUrl && (
                  <a
                    href={branding.facebookUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-10 h-10 border border-border flex items-center justify-center text-muted hover:text-accent hover:border-accent transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  </a>
                )}
                {branding?.instagramUrl && (
                  <a
                    href={branding.instagramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-10 h-10 border border-border flex items-center justify-center text-muted hover:text-accent hover:border-accent transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="aspect-video md:aspect-auto min-h-[350px] bg-hover border border-border overflow-hidden">
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
      </section>
    </div>
  );
}
