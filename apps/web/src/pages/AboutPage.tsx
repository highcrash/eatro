import { useWebsiteContent, useBranding } from '../lib/cms';

export default function AboutPage() {
  const { data: content } = useWebsiteContent();
  const { data: branding } = useBranding();

  return (
    <div>
      <section className="bg-gradient-to-br from-orange-50 to-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900">
            {content?.aboutTitle ?? 'About Us'}
          </h1>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          {content?.aboutImageUrl && (
            <div className="aspect-square bg-gray-100 rounded-2xl overflow-hidden shadow-lg">
              <img
                src={content.aboutImageUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          )}
          <div className={content?.aboutImageUrl ? '' : 'md:col-span-2'}>
            <div className="prose max-w-none text-gray-700 leading-relaxed whitespace-pre-line">
              {content?.aboutBody || 'No content yet.'}
            </div>
            {branding?.websiteTagline && (
              <p className="mt-6 text-orange-500 italic font-semibold">"{branding.websiteTagline}"</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
