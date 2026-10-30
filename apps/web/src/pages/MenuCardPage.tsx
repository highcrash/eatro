import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useBranding, getActiveBranchId } from '../lib/cms';
import { QR_ORDER_PATH, QR_ORDER_URL, QR_ORDER_VIEWBOX } from '../lib/qr-order';

/**
 * /menu-card — print-shop A4 menu in the EATRO brand (cream, beetroot,
 * Playfair + Montserrat). Separate from /menu-print, which stays as is.
 *
 * Every category block is measured off-screen, then packed into A4 sheets
 * in menu order; a block that doesn't fit the space left starts a new
 * sheet, so no category runs onto the next page. `?bleed=0` drops the
 * 3 mm print-shop bleed for proofing on an office printer.
 */

interface CardVariant { id: string; name: string; price: number }
interface CardItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  categoryId: string;
  isAvailable: boolean;
  sortOrder?: number;
  variants?: CardVariant[];
}
interface CardCategory { id: string; name: string; parentId?: string | null; sortOrder: number }
interface CardMenu { categories: CardCategory[]; items: CardItem[] }

interface Group { title: string | null; items: CardItem[] }
interface Block { id: string; title: string; photos: string[]; groups: Group[]; continued?: boolean }
/** One category, or two short ones side by side. */
type Row = Block[];

function BlockRow({ row }: { row: Row }) {
  if (row.length === 1) return <CategoryBlock block={row[0]} />;
  return (
    <div className="mc-pair">
      {row.map((b) => (
        <CategoryBlock key={b.id} block={b} />
      ))}
    </div>
  );
}

const TRIM_W = 210;
const TRIM_H = 297;
const BLEED = 3;
const SAFE = 12; // text keeps this far inside the trim edge
const FOOTER_MM = 16;
const HEADER_MM = 60; // page-1 brand band
const BLOCK_GAP_MM = 6;
// A sheet may shrink its content this much rather than start a new sheet.
const MAX_SHRINK = 0.03;
// Free space (mm) on a sheet worth filling with a photo showcase.
const SHOWCASE_MIN_MM = 75;

const price = (paisa: number) => String(Math.round(Number(paisa) / 100));

/**
 * Short option label: "Latte - Large" → "Large", "Pizza Classic 8 Inch" → `8"`,
 * "Egg Fried Rice - 1:1" under "Fried Rice of the Hidden Villages - 1:1" → "Egg".
 */
function optionLabel(parentName: string, variantName: string): string {
  const name = variantName.trim();
  const p = parentName.trim();
  let label: string;
  if (name.toLowerCase().startsWith(p.toLowerCase())) {
    label = name.slice(p.length);
  } else {
    // Drop the parent's size suffix and any words the parent name already says.
    const suffix = p.match(/\s-\s[^-]+$/)?.[0];
    const base = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
    const parentWords = new Set(p.toLowerCase().split(/[\s\-–]+/));
    label = base.split(/\s+/).filter((w) => !parentWords.has(w.toLowerCase())).join(' ');
  }
  label = label.replace(/^[\s\-–:]+/, '').trim() || 'Regular';
  return label.replace(/^(\d+)\s*Inch$/i, '$1"');
}

/** First sentence, kept to one printed line in a half-page column (~58 characters). */
function shortDescription(text: string | null): string | null {
  if (!text) return null;
  const first = text.trim().split(/(?<=[.!?])\s/)[0].replace(/[.\s]+$/, '');
  if (first.length <= 60) return first;
  // Prefer ending where a new clause starts (", served…", ", in your choice…") over a cut-off phrase.
  // Not ", with" / ", and": what follows those usually names the flavour or main ingredient.
  const clauses = [...first.matchAll(/,\s+(?:served|topped|finished|garnished|in|then|paired|perfect|delivering|creating|made|for)\b/gi)];
  const pause = clauses.map((m) => m.index!).filter((i) => i >= 28 && i <= 60).pop();
  if (pause !== undefined) return first.slice(0, pause);
  return first.slice(0, 58).replace(/[\s,;]+\S*$/, '').replace(/\s+(and|with|or|in|of|a|the)$/i, '') + '…';
}

function options(item: CardItem) {
  return [...(item.variants ?? [])]
    .sort((a, b) => Number(a.price) - Number(b.price))
    .map((v) => ({ label: optionLabel(item.name, v.name), price: v.price }));
}

/** Size table columns when most option items in a group share one label set. */
function sizeColumns(items: CardItem[]): string[] | null {
  const sets = items.filter((i) => (i.variants?.length ?? 0) > 1).map((i) => options(i).map((o) => o.label).join('|'));
  if (sets.length < 2) return null;
  const counts = new Map<string, number>();
  for (const s of sets) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / sets.length >= 0.6 ? best.split('|') : null;
}

function QrMark({ size }: { size: string }) {
  return (
    <svg viewBox={QR_ORDER_VIEWBOX} style={{ width: size, height: size }} shapeRendering="crispEdges" aria-label={QR_ORDER_URL}>
      <path stroke="#2b1715" d={QR_ORDER_PATH} />
    </svg>
  );
}

function ItemRow({ item }: { item: CardItem }) {
  const opts = options(item);
  const desc = shortDescription(item.description);
  return (
    <div className="mc-item">
      <div className="mc-line">
        <span className="mc-name">{item.name.trim()}</span>
        {opts.length === 0 && <span className="mc-price">{price(item.price)}</span>}
        {opts.length === 1 && <span className="mc-price">{price(opts[0].price)}</span>}
      </div>
      {opts.length > 1 && (
        <div className="mc-opts">
          {opts.map((o) => (
            <span key={o.label}>
              {o.label} <b>{price(o.price)}</b>
            </span>
          ))}
        </div>
      )}
      {desc && <div className="mc-desc">{desc}</div>}
    </div>
  );
}

function SizeTable({ items, columns }: { items: CardItem[]; columns: string[] }) {
  const half = Math.ceil(items.length / 2);
  const halves = [items.slice(0, half), items.slice(half)].filter((h) => h.length);
  return (
    <div className="mc-cols">
      {halves.map((rows, k) => (
        <div key={k} className="mc-table" style={{ gridTemplateColumns: `1fr repeat(${columns.length}, 13mm)` }}>
          <span />
          {columns.map((c) => (
            <span key={c} className="mc-th">{c}</span>
          ))}
          {rows.map((item) => {
            const opts = options(item);
            const byLabel = new Map(opts.map((o) => [o.label, o.price]));
            const fits = opts.length > 1 && opts.every((o) => columns.includes(o.label));
            const desc = shortDescription(item.description);
            return (
              <div key={item.id} className="mc-trow" style={{ gridColumn: `1 / span ${columns.length + 1}`, gridTemplateColumns: 'subgrid' }}>
                <div className="mc-tname">
                  <span className="mc-name">{item.name.trim()}</span>
                  {!fits && opts.length > 1 && (
                    <div className="mc-opts">
                      {opts.map((o) => (
                        <span key={o.label}>
                          {o.label} <b>{price(o.price)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {fits
                  ? columns.map((c) => (
                      <span key={c} className="mc-price mc-cell">{byLabel.has(c) ? price(byLabel.get(c)!) : '–'}</span>
                    ))
                  : opts.length <= 1 && (
                      <span className="mc-price mc-cell" style={{ gridColumn: `${columns.length + 1}` }}>
                        {price(opts[0]?.price ?? item.price)}
                      </span>
                    )}
                {/* Full row width so it stays on one line under name and prices. */}
                {desc && <div className="mc-desc" style={{ gridColumn: '1 / -1' }}>{desc}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CategoryBlock({ block }: { block: Block }) {
  return (
    <section className="mc-block">
      <header className="mc-head">
        <div className="mc-head-text">
          <h2>{block.title}{block.continued ? <span className="mc-cont"> continued</span> : null}</h2>
          <i className="mc-rule" />
        </div>
        {block.photos.length > 0 && (
          <div className="mc-photos">
            {block.photos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        )}
      </header>
      {block.groups.map((g, k) => {
        const columns = sizeColumns(g.items);
        return (
          <div key={k} className="mc-group">
            {g.title && <h3>{g.title}</h3>}
            {columns ? (
              <SizeTable items={g.items} columns={columns} />
            ) : (
              <div className="mc-cols mc-list">
                {g.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default function MenuCardPage() {
  const branchId = getActiveBranchId();
  const [params, setParams] = useSearchParams();
  const bleed = params.get('bleed') !== '0';
  const { data: branding } = useBranding();
  const { data: menu } = useQuery<CardMenu>({
    queryKey: ['public-menu-print', branchId],
    queryFn: () => api.getMenuPrint<CardMenu>(branchId),
  });

  useEffect(() => {
    const id = 'mc-montserrat';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';
    document.head.appendChild(link);
  }, []);

  const blocks = useMemo<Block[]>(() => {
    if (!menu) return [];
    const live = menu.items.filter((i) => i.isAvailable);
    const sortItems = (xs: CardItem[]) => [...xs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    const bySort = (a: CardCategory, b: CardCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    return menu.categories
      .filter((c) => !c.parentId)
      .sort(bySort)
      .map((top) => {
        const subs = menu.categories.filter((c) => c.parentId === top.id).sort(bySort);
        const groups: Group[] = [
          { title: null, items: sortItems(live.filter((i) => i.categoryId === top.id)) },
          ...subs.map((s) => ({ title: s.name, items: sortItems(live.filter((i) => i.categoryId === s.id)) })),
        ].filter((g) => g.items.length > 0);
        const photos = groups.flatMap((g) => g.items).filter((i) => i.imageUrl).slice(0, 2).map((i) => i.imageUrl!);
        return { id: top.id, title: top.name, photos, groups };
      })
      .filter((b) => b.groups.length > 0);
  }, [menu]);

  /** Up to four dish photos for a sheet's showcase: its own dishes first, then the rest of the menu. */
  const showcasePhotos = (pageRows: Row[]) => {
    const onPage = pageRows.flat();
    const used = new Set([...onPage.flatMap((b) => b.photos), ...heroPhotos]);
    const own = onPage.flatMap((b) => b.groups.flatMap((g) => g.items)).map((i) => i.imageUrl);
    const rest = blocks.flatMap((b) => b.groups.flatMap((g) => g.items)).map((i) => i.imageUrl);
    const picked: string[] = [];
    for (const src of [...own, ...rest]) {
      if (src && !used.has(src) && !picked.includes(src)) picked.push(src);
      if (picked.length === 4) break;
    }
    return picked;
  };

  const heroPhotos = useMemo(
    () => blocks.filter((b) => b.photos.length).slice(0, 3).map((b) => b.photos[0]),
    [blocks],
  );

  // ── Measure blocks, then pack them into sheets ───────────────────────
  // Short neighbouring categories (one list, ≤ 6 dishes) share a row side by side.
  const rows = useMemo<Row[]>(() => {
    const small = (b: Block) => b.groups.length === 1 && b.groups[0].items.length <= 6;
    const out: Row[] = [];
    for (let i = 0; i < blocks.length; i++) {
      if (small(blocks[i]) && blocks[i + 1] && small(blocks[i + 1])) { out.push([blocks[i], blocks[i + 1]]); i++; }
      else out.push([blocks[i]]);
    }
    return out;
  }, [blocks]);

  const measureRef = useRef<HTMLDivElement>(null);
  const mmRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Array<{ rows: Row[]; scale: number; showcase: boolean }> | null>(null);
  const [layoutNote, setLayoutNote] = useState('');
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    // Montserrat arrives after mount; give it a moment, then wait for every face.
    const t = setTimeout(() => void document.fonts.ready.then(() => alive && setFontsReady(true)), 300);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  useLayoutEffect(() => {
    if (!fontsReady || !rows.length || !measureRef.current || !mmRef.current) return;
    const pxPerMm = mmRef.current.getBoundingClientRect().width / 100;
    const contentH = (TRIM_H - 2 * SAFE - FOOTER_MM) * pxPerMm;
    const gap = BLOCK_GAP_MM * pxPerMm;
    const els = Array.from(measureRef.current.querySelectorAll<HTMLElement>('[data-measure]'));
    const heightOf = (key: string) => els.find((e) => e.dataset.measure === key)!.getBoundingClientRect().height;

    // Units to place: whole rows; a lone category taller than a full sheet is split at its sub-groups.
    const units: Array<{ row: Row; h: number }> = [];
    rows.forEach((row, r) => {
      const h = heightOf(`row:${r}`);
      if (row.length > 1 || h <= contentH) { units.push({ row, h }); return; }
      const b = row[0];
      let cur: Block = { ...b, groups: [] };
      let used = 0;
      b.groups.forEach((g, k) => {
        const gh = heightOf(`${b.id}:${k}`);
        if (cur.groups.length && used + gh > contentH) { units.push({ row: [cur], h: used }); cur = { ...b, groups: [], continued: true }; used = 0; }
        cur.groups.push(g);
        used += gh;
      });
      units.push({ row: [cur], h: used });
    });
    const out: Array<{ rows: Row[]; used: number }> = [{ rows: [], used: HEADER_MM * pxPerMm }]; // page 1 starts below the brand band
    for (const u of units) {
      let page = out[out.length - 1];
      if (page.rows.length && page.used + u.h > contentH * (1 + MAX_SHRINK)) {
        page = { rows: [], used: 0 };
        out.push(page);
      }
      page.rows.push(u.row);
      page.used += u.h + gap;
    }
    setPages(
      out.map((p) => ({
        rows: p.rows,
        scale: Math.min(1, contentH / (p.used - gap)),
        showcase: contentH - p.used >= SHOWCASE_MIN_MM * pxPerMm,
      })),
    );
    // Row heights in mm, exposed for print QA (data-layout on the root).
    setLayoutNote(units.map((u) => `${u.row.map((b) => b.title).join('+')}=${Math.round(u.h / pxPerMm)}`).join('; ') + ` | page=${Math.round(contentH / pxPerMm)}`);
  }, [fontsReady, rows]);

  const sheetW = TRIM_W + (bleed ? 2 * BLEED : 0);
  const sheetH = TRIM_H + (bleed ? 2 * BLEED : 0);
  const pad = SAFE + (bleed ? BLEED : 0);
  const logo = branding?.logoUrl ?? null;

  return (
    <div className="mc-root" data-layout={layoutNote}>
      <style>{`
        @page { size: ${sheetW}mm ${sheetH}mm; margin: 0; }
        html, body { margin: 0; background: #e9e1d2; }
        .mc-root { --cream:#fff3d9; --beet:#c15c58; --orange:#E99207; --ink:#2b1715; --gray:#6F6F6F;
          font-family: Montserrat, system-ui, sans-serif; color: var(--ink);
          -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .mc-toolbar { position: sticky; top: 0; z-index: 5; display:flex; gap:12px; align-items:center; justify-content:center;
          padding:10px; background:#2b1715; color:#fff3d9; font-size:13px; }
        .mc-toolbar button { background:var(--beet); color:#fff; border:0; padding:8px 16px; border-radius:20px; font:600 13px Montserrat, sans-serif; cursor:pointer; }
        .mc-toolbar label { display:flex; gap:6px; align-items:center; cursor:pointer; }
        .mc-sheet { width:${sheetW}mm; height:${sheetH}mm; margin: 10mm auto; background: var(--cream); position:relative;
          box-sizing:border-box; padding:${pad}mm ${pad}mm 0; overflow:hidden; box-shadow: 0 6px 30px rgba(43,23,21,.18);
          page-break-after: always; break-after: page; }
        .mc-sheet:last-child { page-break-after: auto; break-after: auto; }
        .mc-content { height: ${TRIM_H - 2 * SAFE - FOOTER_MM}mm; }
        .mc-flow { display:flex; flex-direction:column; gap:${BLOCK_GAP_MM}mm; transform-origin: top left; min-height:100%; }
        .mc-showcase { margin-top:auto; padding-bottom:4mm; display:flex; flex-direction:column; align-items:center; gap:7mm; flex:none; }
        .mc-showcase-photos { display:flex; justify-content:center; }
        .mc-showcase-photos img { width:40mm; height:40mm; border-radius:50%; object-fit:cover; box-shadow:0 3mm 7mm rgba(43,23,21,.18); }
        .mc-showcase-photos img + img { margin-left:-6mm; }
        .mc-showcase-photos img:nth-child(2), .mc-showcase-photos img:nth-child(3) { width:46mm; height:46mm; }
        .mc-showcase-text { display:flex; align-items:center; gap:12mm; }
        .mc-showcase-line { font:italic 400 22pt 'Playfair Display', serif; color:var(--beet); }
        .mc-showcase-qr { display:flex; align-items:center; gap:4mm; }
        .mc-showcase-qr b { display:block; font:700 8pt Montserrat, sans-serif; letter-spacing:.24em; text-transform:uppercase; color:var(--beet); }
        .mc-showcase-qr span { display:block; margin-top:1mm; font:italic 400 7.4pt Montserrat, sans-serif; color:var(--gray); max-width:38mm; }
        .mc-band { height:${HEADER_MM - BLOCK_GAP_MM}mm; display:grid; grid-template-columns: 1fr auto; gap:8mm; align-items:center; flex:none; }
        .mc-brand img.mc-logo { height:22mm; width:auto; display:block; }
        .mc-brand .mc-tag { margin-top:3mm; font:600 7.5pt Montserrat, sans-serif; letter-spacing:.42em; color:var(--beet); }
        .mc-brand .mc-title { margin-top:4mm; font:italic 400 28pt 'Playfair Display', serif; color:var(--ink); line-height:1; }
        .mc-brand .mc-note { margin-top:3mm; font:500 7pt Montserrat, sans-serif; letter-spacing:.2em; color:var(--gray); text-transform:uppercase; }
        .mc-hero { display:flex; gap:3mm; align-items:center; }
        .mc-hero img { width:30mm; height:30mm; border-radius:50%; object-fit:cover; box-shadow:0 3mm 6mm rgba(43,23,21,.18); }
        .mc-hero img:nth-child(2) { width:38mm; height:38mm; }
        .mc-qrbig { display:flex; flex-direction:column; align-items:center; gap:1.5mm; margin-left:4mm; text-align:center;
          font:600 6.5pt Montserrat, sans-serif; letter-spacing:.12em; color:var(--beet); text-transform:uppercase; }
        .mc-qrbig span.mc-qrurl { font:500 6pt Montserrat, sans-serif; letter-spacing:.05em; color:var(--gray); text-transform:none; }
        .mc-block { flex:none; }
        .mc-head { display:flex; align-items:flex-end; justify-content:space-between; gap:6mm; margin-bottom:1.6mm; }
        .mc-head-text { flex:1; }
        .mc-head h2 { margin:0; font:600 19pt 'Playfair Display', serif; color:var(--beet); letter-spacing:.01em; line-height:1.1; }
        .mc-cont { font:italic 400 10pt 'Playfair Display', serif; color:var(--gray); }
        .mc-rule { display:block; width:22mm; height:0.5mm; background:var(--orange); margin-top:1.6mm; border-radius:1mm; }
        .mc-photos { display:flex; flex:none; }
        .mc-photos img { width:17mm; height:17mm; border-radius:50%; object-fit:cover; box-shadow:0 2mm 5mm rgba(43,23,21,.16); }
        .mc-photos img + img { margin-left:-4mm; }
        .mc-group + .mc-group { margin-top:2.2mm; }
        .mc-group h3 { margin:0 0 1.4mm; font:700 7pt Montserrat, sans-serif; letter-spacing:.32em; text-transform:uppercase; color:var(--orange); }
        .mc-cols { display:grid; grid-template-columns: 1fr 1fr; column-gap:10mm; row-gap:2.4mm; }
        .mc-cols.mc-list { display:block; columns:2; column-gap:10mm; }
        .mc-pair { display:grid; grid-template-columns:1fr 1fr; column-gap:10mm; align-items:start; flex:none; }
        .mc-pair .mc-cols.mc-list { columns:1; }
        .mc-pair .mc-cols { grid-template-columns:1fr; }
        .mc-item { break-inside: avoid; padding-bottom:1.9mm; }
        .mc-line { display:flex; justify-content:space-between; gap:3mm; align-items:baseline; }
        .mc-name { font:600 9pt Montserrat, sans-serif; color:var(--ink); }
        .mc-price { font:700 9pt Montserrat, sans-serif; color:var(--beet); white-space:nowrap; }
        .mc-opts { display:flex; flex-wrap:wrap; gap:.6mm 3.5mm; margin-top:.5mm; font:500 7.4pt Montserrat, sans-serif; color:var(--gray); }
        .mc-opts b { color:var(--beet); font-weight:700; }
        .mc-desc { margin-top:.4mm; font:italic 400 7.2pt Montserrat, sans-serif; color:var(--gray); line-height:1.35; }
        .mc-table { display:grid; column-gap:2mm; row-gap:1.8mm; align-content:start; }
        .mc-th { font:700 6pt Montserrat, sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--orange); text-align:right; }
        .mc-trow { display:grid; align-items:baseline; }
        .mc-cell { text-align:right; }
        .mc-footer { position:absolute; left:${pad}mm; right:${pad}mm; bottom:${pad - 4}mm; height:${FOOTER_MM - 4}mm;
          display:flex; align-items:center; gap:3mm; font:500 6.6pt Montserrat, sans-serif; color:var(--gray); letter-spacing:.04em; }
        .mc-footer .mc-sep { flex:1; height:0.3mm; background:rgba(193,92,88,.35); }
        .mc-footer b { color:var(--beet); font-weight:600; letter-spacing:.14em; text-transform:uppercase; }
        .mc-measure { position:absolute; left:-10000px; top:0; width:${TRIM_W - 2 * SAFE}mm; visibility:hidden; }
        .mc-status { text-align:center; padding:40px; font:500 14px Montserrat, sans-serif; color:#6F6F6F; }
        @media print {
          html, body { background: none; }
          .mc-toolbar, .mc-measure { display:none !important; }
          .mc-sheet { margin:0; box-shadow:none; }
        }
      `}</style>

      <div className="mc-toolbar">
        <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
        <label>
          <input type="checkbox" checked={bleed} onChange={(e) => setParams(e.target.checked ? {} : { bleed: '0' })} />
          3 mm bleed (print shop)
        </label>
        <span>{pages ? `${pages.length} pages · A4` : 'Laying out…'}</span>
      </div>

      <div ref={mmRef} style={{ position: 'absolute', width: '100mm', height: 0, visibility: 'hidden' }} />

      {/* Off-screen copies used only to measure each row and sub-group. */}
      <div ref={measureRef} className="mc-measure" aria-hidden>
        {rows.map((row, r) => (
          <div key={r}>
            <div data-measure={`row:${r}`}><BlockRow row={row} /></div>
            {row.length === 1 &&
              row[0].groups.map((g, k) => (
                <div key={k} data-measure={`${row[0].id}:${k}`}><CategoryBlock block={{ ...row[0], groups: [g] }} /></div>
              ))}
          </div>
        ))}
      </div>

      {!pages && <div className="mc-status">Preparing the menu…</div>}

      {pages?.map(({ rows: pageRows, scale, showcase }, n) => (
        <div key={n} className="mc-sheet" data-page={n + 1}>
          <div className="mc-content">
            <div className="mc-flow" style={scale < 1 ? { transform: `scale(${scale})`, width: `${100 / scale}%` } : undefined}>
            {n === 0 && (
              <div className="mc-band">
                <div className="mc-brand">
                  {/* The EATRO logo artwork already carries the tagline. */}
                  {logo ? (
                    <img className="mc-logo" src={logo} alt={branding?.name ?? 'EATRO'} />
                  ) : (
                    <>
                      <div className="mc-title">EATRO</div>
                      <div className="mc-tag">WHERE FLAVOR TAKES THE LEAD</div>
                    </>
                  )}
                  <div className="mc-title">Our Menu</div>
                  <div className="mc-note">All prices in BDT</div>
                </div>
                <div className="mc-hero">
                  {heroPhotos.map((src) => (
                    <img key={src} src={src} alt="" />
                  ))}
                  <div className="mc-qrbig">
                    <QrMark size="24mm" />
                    Scan to order
                    <span className="mc-qrurl">from your table</span>
                  </div>
                </div>
              </div>
            )}
            {pageRows.map((row) => (
              <BlockRow key={row.map((b) => `${b.id}-${b.groups[0]?.title ?? ''}`).join('+')} row={row} />
            ))}
            {showcase && (
              <div className="mc-showcase">
                <div className="mc-showcase-photos">
                  {showcasePhotos(pageRows).map((src) => (
                    <img key={src} src={src} alt="" />
                  ))}
                </div>
                <div className="mc-showcase-text">
                  <div className="mc-showcase-line">Where flavor takes the lead</div>
                  <div className="mc-showcase-qr">
                    <QrMark size="22mm" />
                    <div>
                      <b>Scan to order</b>
                      <span>Order straight from your table, no waiting.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
          <footer className="mc-footer">
            {n > 0 && <QrMark size="9mm" />}
            {n > 0 && <b>Scan to order</b>}
            <span className="mc-sep" />
            <span>{branding?.phone}</span>
            <span>·</span>
            <span>{branding?.address}</span>
            <span className="mc-sep" />
            <b>{n + 1} / {pages.length}</b>
          </footer>
        </div>
      ))}
    </div>
  );
}
