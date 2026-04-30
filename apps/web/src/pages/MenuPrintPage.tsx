import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import { useBranding, getActiveBranchId } from '../lib/cms';

/**
 * /menu-print — printable A4 hardcopy of the public menu.
 *
 * Lives OUTSIDE SiteLayout so the printed page has no nav/footer chrome.
 * Shares the visibility logic of the regular menu (categories admin
 * hid, items flagged `websiteVisible=false`, ingredients flagged
 * `showOnWebsite=false` — all enforced server-side by the
 * `/public/menu-print/:branchId` endpoint).
 *
 * Layout: 2-column CSS grid. Each item card has `break-inside: avoid`
 * so an item's image / name / description / ingredients / price never
 * split across pages. Categories ALSO use `break-inside: avoid`
 * (best-effort — long categories will still break, but only between
 * card boundaries).
 *
 * Theme: a local light/dark toggle. We don't touch the global
 * `body.dark` / `body.light` class so the user's site-wide preference
 * isn't disturbed when they bounce back to the website.
 */

interface PrintMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discountedPrice?: number | null;
  imageUrl: string | null;
  categoryId: string;
  isAvailable: boolean;
  isVariantParent?: boolean;
  variants?: Array<{ id: string; name: string; price: number }>;
  keyIngredients: Array<{ id: string; name: string; imageUrl: string | null }>;
}

interface PrintMenu {
  categories: Array<{ id: string; name: string; parentId?: string | null; sortOrder: number }>;
  items: PrintMenuItem[];
}

export default function MenuPrintPage() {
  const branchId = getActiveBranchId();
  const { data: branding } = useBranding();
  const { data: menu, isLoading } = useQuery<PrintMenu>({
    queryKey: ['public-menu-print', branchId],
    queryFn: () => api.getMenuPrint<PrintMenu>(branchId),
  });

  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Group items under their category. Subcategories surface as their
  // own section — the print page is flat, not nested. Categories with
  // zero visible items disappear so admins don't get an empty heading.
  const sections = useMemo(() => {
    if (!menu) return [];
    const byCategory = new Map<string, PrintMenuItem[]>();
    for (const item of menu.items) {
      if (!item.isAvailable) continue;
      const arr = byCategory.get(item.categoryId) ?? [];
      arr.push(item);
      byCategory.set(item.categoryId, arr);
    }
    return menu.categories
      .map((cat) => ({ category: cat, items: byCategory.get(cat.id) ?? [] }))
      .filter((s) => s.items.length > 0);
  }, [menu]);

  const printedAt = useMemo(() => {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }, []);

  const logoUrl = branding?.logoUrl
    ? branding.logoUrl.startsWith('http') || branding.logoUrl.startsWith('/')
      ? branding.logoUrl
      : `/${branding.logoUrl}`
    : null;

  return (
    <div data-theme={theme} className="menu-print-root">
      {/* Print + theme styles scoped to the page so site-wide CSS is
          untouched. The :root rule sets the print page colour scheme,
          and `.no-print` hides the toolbar at print time. */}
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }

        .menu-print-root {
          font-family: 'DM Sans', system-ui, sans-serif;
          color: #111;
          background: #fff;
          min-height: 100vh;
        }
        .menu-print-root[data-theme="dark"] {
          color: #F2EDE6;
          background: #0D0D0D;
          color-scheme: dark;
        }

        .mp-toolbar {
          position: sticky; top: 0; z-index: 10;
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 24px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid #E8E6E3;
        }
        .menu-print-root[data-theme="dark"] .mp-toolbar {
          background: rgba(13,13,13,0.92);
          border-bottom-color: #2A2A2A;
        }
        .mp-btn {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
          padding: 8px 14px;
          border: 1px solid #111; background: transparent; color: inherit;
          cursor: pointer;
        }
        .menu-print-root[data-theme="dark"] .mp-btn { border-color: #F2EDE6; }
        .mp-btn-primary { background: #D62B2B; color: #fff; border-color: #D62B2B; }
        .mp-btn:hover { opacity: 0.85; }

        .mp-page {
          max-width: 794px; /* ~A4 width at 96dpi */
          margin: 0 auto;
          padding: 24px 28px 32px;
        }

        .mp-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px;
          padding-bottom: 16px; margin-bottom: 20px;
          border-bottom: 2px solid #111;
        }
        .menu-print-root[data-theme="dark"] .mp-header { border-bottom-color: #F2EDE6; }
        .mp-brand { display: flex; align-items: center; gap: 14px; }
        .mp-logo { width: 56px; height: 56px; object-fit: contain; }
        .mp-brand-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px; letter-spacing: 0.12em; line-height: 1;
          margin: 0;
        }
        .mp-brand-sub {
          font-size: 11px; color: #666; margin-top: 4px;
          letter-spacing: 0.05em;
        }
        .menu-print-root[data-theme="dark"] .mp-brand-sub { color: #999; }
        .mp-meta {
          text-align: right;
          font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
          color: #666;
        }
        .menu-print-root[data-theme="dark"] .mp-meta { color: #999; }
        .mp-meta-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; letter-spacing: 0.2em; color: #D62B2B;
          margin-bottom: 2px;
        }

        .mp-category {
          break-inside: avoid;
          page-break-inside: avoid;
          margin-bottom: 18px;
        }
        .mp-cat-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; letter-spacing: 0.18em;
          margin: 18px 0 12px;
          padding-bottom: 6px;
          border-bottom: 1px solid #D62B2B;
          color: #D62B2B;
        }

        .mp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .mp-card {
          break-inside: avoid;
          page-break-inside: avoid;
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 10px;
          padding: 10px;
          border: 1px solid #E8E6E3;
          background: #FAFAF7;
        }
        .menu-print-root[data-theme="dark"] .mp-card {
          border-color: #2A2A2A;
          background: #161616;
        }
        .mp-img {
          width: 80px; height: 80px;
          object-fit: cover;
          background: #F2F1EE;
        }
        .menu-print-root[data-theme="dark"] .mp-img { background: #1F1F1F; }
        .mp-img-empty {
          width: 80px; height: 80px;
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; opacity: 0.3;
          background: #F2F1EE;
        }
        .menu-print-root[data-theme="dark"] .mp-img-empty {
          background: #1F1F1F;
        }
        .mp-card-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .mp-card-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px;
        }
        .mp-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 16px; letter-spacing: 0.06em;
          line-height: 1.1;
          margin: 0;
        }
        .mp-price {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 16px; letter-spacing: 0.04em;
          color: #D62B2B;
          white-space: nowrap;
        }
        .mp-desc {
          font-size: 10.5px; line-height: 1.35;
          color: #555;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .menu-print-root[data-theme="dark"] .mp-desc { color: #BBB; }

        .mp-pills {
          display: flex; flex-wrap: wrap; gap: 4px;
          margin-top: 4px;
        }
        .mp-pill {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 6px;
          border: 1px solid #D62B2B;
          background: rgba(214,43,43,0.06);
          font-size: 9.5px; letter-spacing: 0.04em;
          color: #D62B2B;
          line-height: 1.2;
        }
        .menu-print-root[data-theme="dark"] .mp-pill {
          background: rgba(214,43,43,0.14);
        }
        .mp-pill-img {
          width: 14px; height: 14px;
          object-fit: cover;
          border-radius: 50%;
        }

        .mp-empty {
          padding: 60px 20px; text-align: center;
          font-size: 14px; color: #666;
        }

        @media print {
          .no-print { display: none !important; }
          .mp-page { padding: 0; max-width: none; }
          .mp-toolbar { display: none !important; }
          .menu-print-root { background: ${theme === 'dark' ? '#0D0D0D' : '#fff'} !important; }
          /* color-adjust: keeps the brand reds + image colors intact
             when the printer would otherwise drop background fills */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      {/* Toolbar — hidden in print */}
      <div className="mp-toolbar no-print">
        <Link
          to="/"
          style={{
            fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
            color: 'inherit', textDecoration: 'none', opacity: 0.7,
          }}
        >
          ← Back to website
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mp-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '🌙 Dark' : '☀ Light'}
          </button>
          <button className="mp-btn mp-btn-primary" onClick={() => window.print()}>
            🖨 Print
          </button>
        </div>
      </div>

      {/* Printable area */}
      <div className="mp-page">
        {/* Header */}
        <div className="mp-header">
          <div className="mp-brand">
            {logoUrl ? (
              <img src={logoUrl} alt={branding?.name ?? ''} className="mp-logo" />
            ) : null}
            <div>
              <h1 className="mp-brand-name">{branding?.name ?? 'Menu'}</h1>
              {branding?.address ? (
                <div className="mp-brand-sub">{branding.address}</div>
              ) : null}
              {branding?.phone ? (
                <div className="mp-brand-sub">{branding.phone}</div>
              ) : null}
            </div>
          </div>
          <div className="mp-meta">
            <div className="mp-meta-title">MENU</div>
            <div>{printedAt}</div>
          </div>
        </div>

        {isLoading && <div className="mp-empty">Loading menu…</div>}
        {!isLoading && sections.length === 0 && (
          <div className="mp-empty">No menu items to display.</div>
        )}

        {sections.map(({ category, items }) => (
          <section key={category.id} className="mp-category">
            <h2 className="mp-cat-title">{category.name}</h2>
            <div className="mp-grid">
              {items.map((item) => {
                const price = item.discountedPrice ?? item.price;
                // Variant parents have no own price — show the cheapest
                // variant as a "from" price, mirroring MenuPage.tsx
                // FoodCard logic.
                const fromVariant =
                  item.isVariantParent && item.variants && item.variants.length > 0
                    ? Math.min(...item.variants.map((v) => Number(v.price)))
                    : null;
                const displayPrice = fromVariant ?? Number(price);
                const priceLabel =
                  fromVariant !== null
                    ? `${formatCurrency(displayPrice)}+`
                    : formatCurrency(displayPrice);
                return (
                  <article key={item.id} className="mp-card">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="mp-img" />
                    ) : (
                      <div className="mp-img-empty">🍽️</div>
                    )}
                    <div className="mp-card-body">
                      <div className="mp-card-head">
                        <h3 className="mp-name">{item.name}</h3>
                        <span className="mp-price">{priceLabel}</span>
                      </div>
                      {item.description ? (
                        <p className="mp-desc">{item.description}</p>
                      ) : null}
                      {item.keyIngredients.length > 0 && (
                        <div className="mp-pills">
                          {item.keyIngredients.map((ing) => (
                            <span key={ing.id} className="mp-pill">
                              {ing.imageUrl ? (
                                <img src={ing.imageUrl} alt="" className="mp-pill-img" />
                              ) : null}
                              {ing.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
