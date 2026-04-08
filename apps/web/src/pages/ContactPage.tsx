import { useBranding, useWebsiteContent } from '../lib/cms';

export default function ContactPage() {
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();

  return (
    <div>
      <section className="bg-gradient-to-br from-orange-50 to-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900">Visit Us</h1>
          <p className="text-gray-600 mt-2">We'd love to see you</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          {content?.contactNote && (
            <p className="text-gray-700 mb-6 whitespace-pre-line">{content.contactNote}</p>
          )}

          <div className="space-y-4">
            {branding?.address && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Address</p>
                <p className="text-gray-900 mt-1">{branding.address}</p>
              </div>
            )}
            {branding?.phone && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Phone</p>
                <a href={`tel:${branding.phone}`} className="text-orange-500 font-semibold mt-1 inline-block hover:underline">
                  {branding.phone}
                </a>
              </div>
            )}
            {branding?.email && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Email</p>
                <a href={`mailto:${branding.email}`} className="text-orange-500 font-semibold mt-1 inline-block hover:underline">
                  {branding.email}
                </a>
              </div>
            )}
          </div>

          {(branding?.facebookUrl || branding?.instagramUrl) && (
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Follow Us</p>
              <div className="flex gap-3">
                {branding?.facebookUrl && (
                  <a
                    href={branding.facebookUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-gray-100 hover:bg-orange-500 hover:text-white text-gray-700 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
                  >
                    Facebook
                  </a>
                )}
                {branding?.instagramUrl && (
                  <a
                    href={branding.instagramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-gray-100 hover:bg-orange-500 hover:text-white text-gray-700 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
                  >
                    Instagram
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="aspect-[4/3] md:aspect-auto bg-gray-100 rounded-2xl overflow-hidden shadow-lg min-h-[300px]">
          {content?.mapEmbedUrl ? (
            <iframe
              src={content.mapEmbedUrl}
              title="Map"
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-7xl">📍</div>
          )}
        </div>
      </section>
    </div>
  );
}
