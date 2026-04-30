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
 * v2 mockup notes:
 *   - Subcategories are merged under their top-level parent so admins
 *     don't see "Appetizer" then "Appetizer / Snacks" as two sections.
 *   - Variants render as a vertical price list under the item name.
 *   - Addon groups render once per item (in dark/light text, no chips),
 *     with "+price" suffixed; free addons (price 0) show name only.
 *   - Page background extends to all four edges in dark mode (the A4
 *     margins are achieved with internal padding, NOT @page margin —
 *     otherwise the printer leaves white strips around the dark page).
 *
 * Theme: local light/dark toggle. We don't touch the global
 * `body.dark` / `body.light` class so the user's site-wide preference
 * isn't disturbed when they bounce back to the website.
 */

interface PrintAddon {
  id: string;
  addonItemId: string;
  addon: { id: string; name: string; price: number; isAvailable: boolean };
}
interface PrintAddonGroup {
  id: string;
  name: string;
  options: PrintAddon[];
}
interface PrintVariant {
  id: string;
  name: string;
  price: number;
}
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
  variants?: PrintVariant[];
  addonGroups?: PrintAddonGroup[];
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

  // Walk every item up to its TOP-LEVEL parent category, so subcategory
  // items merge under the parent's heading. Edge case — if an item's
  // category has been orphaned (parent hidden / deleted), it falls
  // back to its own category id.
  const sections = useMemo(() => {
    if (!menu) return [];
    const byId = new Map<string, typeof menu.categories[number]>();
    for (const c of menu.categories) byId.set(c.id, c);
    const topParentFor = (catId: string): string => {
      let cur = byId.get(catId);
      if (!cur) return catId;
      while (cur.parentId && byId.has(cur.parentId)) cur = byId.get(cur.parentId)!;
      return cur.id;
    };

    const byTopParent = new Map<string, PrintMenuItem[]>();
    for (const item of menu.items) {
      if (!item.isAvailable) continue;
      const topId = topParentFor(item.categoryId);
      const arr = byTopParent.get(topId) ?? [];
      arr.push(item);
      byTopParent.set(topId, arr);
    }

    const topLevel = menu.categories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return topLevel
      .map((cat) => ({ category: cat, items: byTopParent.get(cat.id) ?? [] }))
      .filter((s) => s.items.length > 0);
  }, [menu]);

  const logoUrl = branding?.logoUrl
    ? branding.logoUrl.startsWith('http') || branding.logoUrl.startsWith('/')
      ? branding.logoUrl
      : `/${branding.logoUrl}`
    : null;

  return (
    <div data-theme={theme} className="menu-print-root">
      {/*
        @page margin is ZERO so the page background extends to all
        four edges (otherwise dark mode leaves white printer-margin
        strips). The A4 white-space is recreated with .mp-page
        internal padding instead.
      */}
      <style>{`
        @page { size: A4 portrait; margin: 0; }

        html, body { background: #fff; }

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
        .menu-print-root[data-theme="dark"] body,
        body:has(.menu-print-root[data-theme="dark"]) { background: #0D0D0D; }

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
          max-width: 210mm; /* A4 width */
          margin: 0 auto;
          padding: 14mm 12mm 14mm; /* fakes the printer margin INSIDE the page so the dark/light bg fills to all four edges */
        }

        .mp-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px;
          padding-bottom: 14px; margin-bottom: 18px;
          border-bottom: 2px solid #111;
        }
        .menu-print-root[data-theme="dark"] .mp-header { border-bottom-color: #F2EDE6; }
        .mp-logo {
          width: 64px; height: 64px; object-fit: contain;
        }
        .mp-meta-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px; letter-spacing: 0.22em;
          color: #D62B2B;
          line-height: 1;
        }

        .mp-category {
          break-inside: avoid;
          page-break-inside: avoid;
          margin-bottom: 16px;
        }
        .mp-cat-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; letter-spacing: 0.18em;
          margin: 14px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #D62B2B;
          color: #D62B2B;
        }

        .mp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          align-items: start;
        }

        .mp-card {
          break-inside: avoid;
          page-break-inside: avoid;
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 10px;
          padding: 8px 10px;
          border-bottom: 1px solid #E8E6E3;
        }
        .menu-print-root[data-theme="dark"] .mp-card {
          border-bottom-color: #2A2A2A;
        }

        .mp-img-wrap {
          /* Neutral light background regardless of theme so plated food
             photos with transparent edges don't sit on solid black. */
          width: 80px; height: 80px;
          background: #FFFFFF;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .mp-img { width: 100%; height: 100%; object-fit: cover; }
        .mp-img-empty {
          font-size: 28px; opacity: 0.3;
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

        /* Variants — vertical name : price list. */
        .mp-variants { margin-top: 4px; }
        .mp-variant-row {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 11px;
          padding: 1px 0;
        }
        .mp-variant-name { color: inherit; opacity: 0.92; }
        .mp-variant-price { color: #D62B2B; white-space: nowrap; font-weight: 600; }

        /* Addon groups — text-only, no chips. */
        .mp-addons { margin-top: 4px; }
        .mp-addon-group { font-size: 10.5px; line-height: 1.4; }
        .mp-addon-group + .mp-addon-group { margin-top: 2px; }
        .mp-addon-label {
          font-family: 'Bebas Neue', sans-serif;
          letter-spacing: 0.1em; font-size: 10.5px;
          color: #D62B2B;
        }
        .mp-addon-list {
          color: #444;
        }
        .menu-print-root[data-theme="dark"] .mp-addon-list { color: #CCC; }

        /* Key ingredients — flat text + tiny image, NO border / chip bg.
           Capped to 2 lines via -webkit-line-clamp. */
        .mp-pills {
          display: flex; flex-wrap: wrap; gap: 6px 10px;
          margin-top: 4px;
          font-size: 10px;
          line-height: 1.3;
          color: #666;
          max-height: 2.6em;
          overflow: hidden;
        }
        .menu-print-root[data-theme="dark"] .mp-pills { color: #999; }
        .mp-pill {
          display: inline-flex; align-items: center; gap: 4px;
        }
        .mp-pill-img {
          width: 14px; height: 14px;
          object-fit: cover;
          border-radius: 50%;
          background: #fff;
        }

        .mp-empty {
          padding: 60px 20px; text-align: center;
          font-size: 14px; color: #666;
        }

        @media print {
          .no-print { display: none !important; }
          .mp-toolbar { display: none !important; }
          /* Force the chosen theme's background to print to ALL edges. */
          html, body, .menu-print-root {
            background: ${theme === 'dark' ? '#0D0D0D' : '#FFFFFF'} !important;
          }
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
        {/* Header — logo only on the left, "MENU" mark on the right.
            Address / phone / date are intentionally omitted per owner direction. */}
        <div className="mp-header">
          <div>
            {logoUrl ? (
              <img src={logoUrl} alt={branding?.name ?? 'Logo'} className="mp-logo" />
            ) : null}
          </div>
          <div className="mp-meta-title">MENU</div>
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
                const hasVariants = item.isVariantParent && item.variants && item.variants.length > 0;
                const addonGroups = (item.addonGroups ?? []).filter((g) => g.options.length > 0);
                const hasAddons = addonGroups.length > 0;

                // Item-level price: variant parents show "from X+" of
                // the cheapest variant. Variants are also listed below
                // explicitly so the customer sees the full range.
                const baseFromVariant = hasVariants
                  ? Math.min(...item.variants!.map((v) => Number(v.price)))
                  : null;
                const headPrice =
                  baseFromVariant !== null
                    ? `${formatCurrency(baseFromVariant)}+`
                    : formatCurrency(Number(item.discountedPrice ?? item.price));

                return (
                  <article key={item.id} className="mp-card">
                    <div className="mp-img-wrap">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="mp-img" />
                      ) : (
                        <span className="mp-img-empty">🍽️</span>
                      )}
                    </div>
                    <div className="mp-card-body">
                      <div className="mp-card-head">
                        <h3 className="mp-name">{item.name}</h3>
                        {!hasVariants && <span className="mp-price">{headPrice}</span>}
                        {hasVariants && <span className="mp-price">{headPrice}</span>}
                      </div>
                      {item.description ? (
                        <p className="mp-desc">{item.description}</p>
                      ) : null}

                      {hasVariants && (
                        <div className="mp-variants">
                          {item.variants!.map((v) => (
                            <div key={v.id} className="mp-variant-row">
                              <span className="mp-variant-name">{v.name}</span>
                              <span className="mp-variant-price">
                                {formatCurrency(Number(v.price))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {hasAddons && (
                        <div className="mp-addons">
                          {addonGroups.map((g) => (
                            <div key={g.id} className="mp-addon-group">
                              <span className="mp-addon-label">{g.name}: </span>
                              <span className="mp-addon-list">
                                {g.options
                                  .filter((o) => o.addon.isAvailable !== false)
                                  .map((o) => {
                                    const p = Number(o.addon.price ?? 0);
                                    // Free addon (price 0) → show name only.
                                    return p > 0
                                      ? `${o.addon.name} +${formatCurrency(p)}`
                                      : o.addon.name;
                                  })
                                  .join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

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
