import { useBranding, useWebsiteContent } from '../lib/cms';

export default function MaintenancePage() {
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();
  const bg = (content as any)?.maintenanceBg;
  const text = (content as any)?.maintenanceText;
  const brandName = branding?.name ?? 'Your Restaurant';

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#0D0D0D' }}>
      {bg && (
        <div className="absolute inset-0">
          <img src={bg} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.85)' }} />
        </div>
      )}
      <div className="relative text-center px-6 max-w-2xl">
        {/* Animated gear icon */}
        <div className="mb-8 flex justify-center">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-accent animate-spin" style={{ animationDuration: '8s' }}>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </div>

        <h1 className="font-display text-5xl md:text-7xl tracking-wider mb-4" style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#fff' }}>
          UNDER MAINTENANCE
        </h1>
        <p className="font-body text-lg mb-6 max-w-lg mx-auto" style={{ color: '#999' }}>
          {text || `${brandName} website is currently being updated. We'll be back shortly with something amazing.`}
        </p>
        <div className="inline-flex items-center gap-2 px-6 py-3" style={{ background: '#161616', border: '1px solid #2A2A2A' }}>
          <div className="w-2 h-2 animate-pulse" style={{ background: '#D62B2B' }} />
          <span className="font-body text-sm tracking-wider uppercase" style={{ color: '#999' }}>We'll be back soon</span>
        </div>

        {/* Contact info */}
        {branding?.phone && (
          <p className="font-body text-sm mt-12" style={{ color: '#666' }}>
            Questions? Call us at <a href={`tel:${branding.phone}`} className="hover:underline" style={{ color: '#D62B2B' }}>{branding.phone}</a>
          </p>
        )}
      </div>
    </div>
  );
}
