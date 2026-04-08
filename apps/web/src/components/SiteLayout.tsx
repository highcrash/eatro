import { Link, NavLink, Outlet } from 'react-router-dom';
import { useBranding } from '../lib/cms';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/menu', label: 'Menu' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

function resolveLogoUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

export default function SiteLayout() {
  const { data: branding } = useBranding();
  const brandName = branding?.name ?? 'Restora';
  const logo = resolveLogoUrl(branding?.logoUrl);

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            {logo ? (
              <img src={logo} alt="" className="w-8 h-8 object-contain rounded" />
            ) : (
              <div className="w-8 h-8 bg-orange-500 text-white flex items-center justify-center rounded font-extrabold">
                {brandName.charAt(0)}
              </div>
            )}
            <span>{brandName}</span>
          </Link>
          <nav className="flex gap-6 text-sm font-semibold">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `transition-colors ${isActive ? 'text-orange-500' : 'text-gray-700 hover:text-orange-500'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <p className="font-bold text-xl text-white mb-2">{brandName}</p>
            {branding?.websiteTagline && <p className="text-sm text-gray-400">{branding.websiteTagline}</p>}
          </div>
          <div>
            <p className="font-bold text-sm text-white mb-3 uppercase tracking-wider">Visit</p>
            {branding?.address && <p className="text-sm">{branding.address}</p>}
            {branding?.phone && <p className="text-sm">📞 {branding.phone}</p>}
            {branding?.email && <p className="text-sm">✉ {branding.email}</p>}
          </div>
          <div>
            <p className="font-bold text-sm text-white mb-3 uppercase tracking-wider">Follow</p>
            <div className="flex gap-3">
              {branding?.facebookUrl && <a href={branding.facebookUrl} className="text-gray-400 hover:text-white" target="_blank" rel="noreferrer">Facebook</a>}
              {branding?.instagramUrl && <a href={branding.instagramUrl} className="text-gray-400 hover:text-white" target="_blank" rel="noreferrer">Instagram</a>}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} {brandName}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
