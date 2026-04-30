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
  // Variants may carry their OWN addonGroups when admin attached
  // addons per-variant (instead of at the parent level). Print page
  // prefers variant addons; falls back to parent's when this is empty.
  addonGroups?: PrintAddonGroup[];
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
        @page margin is restored (was 0 in v2). Without per-page
        @page margin, page 2+ would render flush to the top of the
        paper with no padding — broken-looking. The trade-off is
        that dark mode now has a thin printer-margin band of paper
        color around the dark area, which is the physical printer's
        unprintable area anyway. Every page gets consistent
        breathing room top + bottom + sides.
      */}
      <style>{`
        @page { size: A4 portrait; margin: 12mm 10mm; }

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
          max-width: 210mm; /* A4 width — for the on-screen preview */
          margin: 0 auto;
          padding: 14mm 12mm; /* on-screen padding only; @page handles printed margins */
        }
        @media print {
          .mp-page { padding: 0; max-width: none; }
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

        /* Each category is a real HTML table so its thead repeats at
           the top of every printed page the category spans — the
           browser treats display:table-header-group as a "repeat me
           on page break" hint. Without this, a category that spilled
           onto page 2 left the customer with no idea what section
           they were reading. */
        .mp-category {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 16px;
          table-layout: fixed;
        }
        .mp-category thead { display: table-header-group; }
        .mp-category tbody { display: table-row-group; }
        .mp-category td, .mp-category th {
          padding: 0;
          border: none;
          text-align: left;
          vertical-align: top;
        }
        .mp-cat-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; letter-spacing: 0.18em;
          margin: 14px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #D62B2B;
          color: #D62B2B;
          font-weight: normal;
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
          padding: 10px 10px 14px; /* extra bottom padding so the last line of ingredients doesn't kiss the border */
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

        /* Variants — vertical name : price list. Grid (not flex) so
           prices line up at the same right-edge column even when
           a variant name wraps to two lines. */
        .mp-variants { margin-top: 4px; }
        .mp-variant-row {
          display: grid;
          grid-template-columns: 1fr max-content;
          column-gap: 12px;
          align-items: baseline;
          font-size: 11px;
          padding: 1px 0;
        }
        .mp-variant-name { color: inherit; opacity: 0.92; }
        .mp-variant-price {
          color: #D62B2B; white-space: nowrap; font-weight: 600;
          text-align: right;
        }

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

        /* Variant + addons combo: each variant gets its own column
           with the price up top + the addon groups repeated below.
           auto-fit so 3+ variants wrap to a second row instead of
           squeezing into too-narrow columns. */
        .mp-variant-cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
          gap: 6px 10px;
          margin-top: 6px;
        }
        .mp-variant-col {
          font-size: 10.5px;
          line-height: 1.35;
        }
        .mp-variant-col .mp-variant-row {
          padding: 0 0 3px;
          margin-bottom: 3px;
          border-bottom: 1px dotted rgba(214,43,43,0.35);
        }
        .mp-variant-col .mp-addon-group { font-size: 10px; }

        /* Key ingredients — flat inline text + tiny image. Capped to
           2 visible lines via -webkit-line-clamp (proper line-boundary
           clipping, doesn't slice characters mid-letter). */
        .mp-pills {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin-top: 6px;
          font-size: 10px;
          line-height: 1.6;
          color: #666;
        }
        .menu-print-root[data-theme="dark"] .mp-pills { color: #999; }
        .mp-pill {
          display: inline;
          white-space: nowrap;
          margin-right: 10px;
        }
        .mp-pill-img {
          width: 12px; height: 12px;
          object-fit: cover;
          border-radius: 50%;
          background: #fff;
          vertical-align: -2px;
          margin-right: 3px;
          display: inline-block;
        }

        .mp-empty {
          padding: 60px 20px; text-align: center;
          font-size: 14px; color: #666;
        }

        @media print {
          .no-print { display: none !important; }
          .mp-toolbar { display: none !important; }
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
          // <table> + <thead> so the category title repeats at the
          // top of every printed page when this category spans more
          // than one page. The whole grid lives in a single <td> so
          // the existing 2-column CSS-grid layout is preserved.
          <table key={category.id} className="mp-category">
            <thead>
              <tr>
                <th>
                  <h2 className="mp-cat-title">{category.name}</h2>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div className="mp-grid">
                    {items.map((item) => {
                const hasVariants = item.isVariantParent && item.variants && item.variants.length > 0;
                const parentAddonGroups = (item.addonGroups ?? []).filter((g) => g.options.length > 0);
                // Per-variant fallback: when admin attached addons to
                // each variant separately, prefer those; otherwise use
                // the parent's addonGroups.
                const addonGroupsFor = (v: PrintVariant): PrintAddonGroup[] => {
                  const own = (v.addonGroups ?? []).filter((g) => g.options.length > 0);
                  return own.length > 0 ? own : parentAddonGroups;
                };
                const variantHasAddons =
                  hasVariants &&
                  item.variants!.some((v) => addonGroupsFor(v).length > 0);
                const addonGroups = parentAddonGroups; // alias for the no-variants render path
                const hasAddons = variantHasAddons || parentAddonGroups.length > 0;

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

                      {/* Three render modes, mutually exclusive:
                           - variants + addons → side-by-side variant
                             columns, each with the addon groups
                             repeated underneath.
                           - variants only → vertical name/price list.
                           - addons only (no variants) → single block
                             of addon groups under the description. */}
                      {hasVariants && hasAddons && (
                        <div className="mp-variant-cols">
                          {item.variants!.map((v) => {
                            const groups = addonGroupsFor(v);
                            return (
                              <div key={v.id} className="mp-variant-col">
                                <div className="mp-variant-row">
                                  <span className="mp-variant-name">{v.name}</span>
                                  <span className="mp-variant-price">
                                    {formatCurrency(Number(v.price))}
                                  </span>
                                </div>
                                {groups.map((g) => (
                                  <div key={g.id} className="mp-addon-group">
                                    <span className="mp-addon-label">{g.name}: </span>
                                    <span className="mp-addon-list">
                                      {g.options
                                        .filter((o) => o.addon.isAvailable !== false)
                                        .map((o) => {
                                          const p = Number(o.addon.price ?? 0);
                                          return p > 0
                                            ? `${o.addon.name} +${formatCurrency(p)}`
                                            : o.addon.name;
                                        })
                                        .join(', ')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {hasVariants && !hasAddons && (
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

                      {!hasVariants && hasAddons && (
                        <div className="mp-addons">
                          {addonGroups.map((g) => (
                            <div key={g.id} className="mp-addon-group">
                              <span className="mp-addon-label">{g.name}: </span>
                              <span className="mp-addon-list">
                                {g.options
                                  .filter((o) => o.addon.isAvailable !== false)
                                  .map((o) => {
                                    const p = Number(o.addon.price ?? 0);
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
                </td>
              </tr>
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
