import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useBranding, useWebsiteContent } from '../lib/cms';
import BranchSelector from './BranchSelector';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function resolveLogoUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function SiteLayout() {
  const { data: branding } = useBranding();
  const { data: content } = useWebsiteContent();
  const location = useLocation();

  const brandName = branding?.name ?? 'Your Restaurant';
  const logo = resolveLogoUrl(branding?.logoUrl);

  /* ---------- theme ---------- */
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  useEffect(() => {
    document.body.classList.remove('dark', 'light');
    document.body.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  /* ---------- CMS accent overrides ---------- */
  useEffect(() => {
    if (content?.accentColor) document.documentElement.style.setProperty('--accent', content.accentColor);
    if (content?.buttonColor) document.documentElement.style.setProperty('--btn', content.buttonColor);
  }, [content?.accentColor, content?.buttonColor]);

  /* ---------- scroll ---------- */
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------- mobile menu ---------- */
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  /* ---------- nav items ---------- */
  const navItems = [
    { to: '/', label: 'Home', end: true, show: true },
    { to: '/menu', label: 'Menu', show: true },
    { to: '/about', label: 'About', show: true },
    { to: '/contact', label: 'Contact', show: true },
    { to: '/reservation', label: 'Reservation', show: content?.showReservation !== false },
  ];

  const isHome = location.pathname === '/';
  const navBg = scrolled || !isHome
    ? 'bg-[var(--card)]/95 backdrop-blur border-b border-[var(--border)]'
    : 'bg-transparent';

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {/* ====== HEADER ====== */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${navBg}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt="" className="h-8 w-auto object-contain" />
            ) : (
              <div className="w-8 h-8 bg-accent text-white flex items-center justify-center font-display text-lg">
                {brandName.charAt(0)}
              </div>
            )}
            <span className="font-display text-xl tracking-wider text-text">{brandName}</span>
          </Link>

          {/* Branch selector (hidden if single branch) */}
          <BranchSelector />

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.filter((n) => n.show).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `text-sm font-semibold uppercase tracking-wider transition-colors ${
                    isActive ? 'text-accent' : 'text-muted hover:text-text'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 flex items-center justify-center text-muted hover:text-text transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* CTA */}
            {content?.showReservation !== false && (
              <Link
                to="/reservation"
                className="bg-btn hover:opacity-90 text-white font-bold text-sm uppercase tracking-wider px-5 py-2 transition-opacity"
              >
                Book a Table
              </Link>
            )}
          </nav>

          {/* Mobile hamburger */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={toggleTheme}
              className="w-8 h-8 flex items-center justify-center text-muted hover:text-text"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="w-8 h-8 flex items-center justify-center text-text"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden bg-card border-t border-border">
            <nav className="flex flex-col px-6 py-4 gap-3">
              {navItems.filter((n) => n.show).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `text-sm font-semibold uppercase tracking-wider py-2 transition-colors ${
                      isActive ? 'text-accent' : 'text-muted hover:text-text'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {content?.showReservation !== false && (
                <Link
                  to="/reservation"
                  className="bg-btn text-white font-bold text-sm uppercase tracking-wider px-5 py-3 text-center mt-2"
                >
                  Book a Table
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Spacer for fixed header (only on non-home pages) */}
      {!isHome && <div className="h-16" />}

      {/* ====== MAIN ====== */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* ====== FOOTER ====== */}
      <footer className="bg-card border-t border-border mt-0">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              {logo ? (
                <img src={logo} alt="" className="h-8 w-auto object-contain" />
              ) : (
                <div className="w-8 h-8 bg-accent text-white flex items-center justify-center font-display text-lg">
                  {brandName.charAt(0)}
                </div>
              )}
              <span className="font-display text-xl tracking-wider">{brandName}</span>
            </div>
            {branding?.websiteTagline && (
              <p className="text-sm text-muted leading-relaxed">{branding.websiteTagline}</p>
            )}
          </div>

          {/* Navigation */}
          <div>
            <p className="font-display text-lg tracking-wider mb-4">Navigate</p>
            <ul className="space-y-2">
              {navItems.filter((n) => n.show).map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-sm text-muted hover:text-accent transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="font-display text-lg tracking-wider mb-4">Contact</p>
            <div className="space-y-2 text-sm text-muted">
              {branding?.address && <p>{branding.address}</p>}
              {branding?.phone && (
                <a href={`tel:${branding.phone}`} className="block hover:text-accent transition-colors">
                  {branding.phone}
                </a>
              )}
              {branding?.email && (
                <a href={`mailto:${branding.email}`} className="block hover:text-accent transition-colors">
                  {branding.email}
                </a>
              )}
            </div>
          </div>

          {/* Social */}
          <div>
            <p className="font-display text-lg tracking-wider mb-4">Follow Us</p>
            <div className="flex gap-4">
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
        </div>

        <div className="border-t border-border px-6 py-5 text-center text-xs text-muted">
          &copy; {new Date().getFullYear()} {brandName}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
