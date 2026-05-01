import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharpModule = require('sharp');
const sharp = sharpModule;
type SharpOverlay = sharpModule.OverlayOptions;
import { Resvg } from '@resvg/resvg-js';

/**
 * Discount-card image composer.
 *
 * Pixel-perfect 1080×1350 portrait JPEG matching one of two layouts:
 *   - PRICE_DROP — discount applies every day. Big "PRICE DROP"
 *     headline, red "VALID <DATE>" sub-line.
 *   - SELECTED_DAYS — specific days only. "Valid <DATE>" small red
 *     line, big "EVERY" headline, then "<DAY> <DAY> <DAY>" red list.
 *
 * Rendering pipeline:
 *   1. Compose four SEPARATE SVG overlays — one per font face —
 *      because the Hello Paris family files share typographic family
 *      records, and resvg's font matcher gets confused if all five
 *      faces are loaded into a single render context. Loading exactly
 *      one font into each render avoids the disambiguation bug.
 *   2. Composite layers in sharp:
 *        template → food photo → logo → text overlays.
 *
 * Fonts (name = font-family attribute used in each overlay's SVG):
 *   - Perandory             → title (PRICE DROP / EVERY) + red sub-lines
 *   - Hello Paris Script    → handwritten product-name overlay
 *   - Hello Paris Bold      → "Off X%" badge text
 *   - Hello Paris (Regular) → address footer
 */

// Assets ship with the API repo at apps/api/assets/. Resolve from the
// repo root so `process.cwd()` (which varies between dev and prod
// deploys) doesn't matter — use a stable look-up that finds the dir
// regardless of where the process was launched from.
function findAssetsDir(): string {
  // Try the conventional locations in order. First match wins.
  const candidates = [
    join(process.cwd(), 'assets'),
    join(process.cwd(), 'apps', 'api', 'assets'),
    join(__dirname, '..', '..', 'assets'),
    join(__dirname, '..', '..', '..', 'assets'),
  ];
  for (const c of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs');
      if (fs.existsSync(join(c, 'social', 'template.jpg'))) return c;
    } catch { /* keep looking */ }
  }
  // Fallback to the first candidate; readFile will throw with a useful
  // path if it's wrong.
  return candidates[0];
}

const ASSETS_DIR = findAssetsDir();
const TEMPLATE_PATH = join(ASSETS_DIR, 'social', 'template.jpg');
const SPLAT_PATH = join(ASSETS_DIR, 'social', 'splat-transparent.png');
const FONTS_DIR = join(ASSETS_DIR, 'fonts');

const FONT_PERANDORY = join(FONTS_DIR, 'perandory-regular.otf');
const FONT_PERANDORY_COND = join(FONTS_DIR, 'perandory-condensed.otf');
const FONT_HP_SCRIPT = join(FONTS_DIR, 'HelloParisScript.ttf');
const FONT_HP_BOLD = join(FONTS_DIR, 'HelloParisSerif-Bold.ttf');
const FONT_HP_REGULAR = join(FONTS_DIR, 'HelloParisSerif-Regular.ttf');
// Each font's actual family name (id 1 in the OTF/TTF name table) —
// resvg matches by this exact string. Hello Paris Bold is its own
// family (not "Hello Paris" weight 700) because the font's name table
// stores it that way; same trick the inspector script confirmed.
const FF_PERANDORY = 'Perandory';
const FF_PERANDORY_COND = 'Perandory Cond';
const FF_HP_SCRIPT = 'Hello Paris Script';
const FF_HP_BOLD = 'Hello Paris Bold';

let templateBuffer: Buffer | null = null;
let splatBuffer: Buffer | null = null;

async function loadTemplate(): Promise<Buffer> {
  if (!templateBuffer) {
    templateBuffer = await readFile(TEMPLATE_PATH);
  }
  return templateBuffer;
}

async function loadSplat(): Promise<Buffer> {
  if (!splatBuffer) {
    splatBuffer = await readFile(SPLAT_PATH);
  }
  return splatBuffer;
}

const W = 1080;
const H = 1350;

export type ComposeTemplate = 'PRICE_DROP' | 'SELECTED_DAYS';

export interface ComposeDiscountInput {
  productName: string;
  /** Direct URL to the menu item's photo. Null skips that layer. */
  foodImageUrl: string | null;
  discount: { type: 'FLAT' | 'PERCENTAGE'; value: number };
  validity: {
    endDate: Date;
    /** null OR all 7 days → PRICE_DROP layout. */
    days: string[] | null;
  };
  branding: {
    /** Direct URL to the restaurant logo. Null skips that layer. */
    logoUrl: string | null;
    /** Restaurant address — wraps to 2 lines below the logo. */
    address: string;
  };
}

export interface ComposeDiscountResult {
  buffer: Buffer;
  template: ComposeTemplate;
}

export function pickTemplate(days: string[] | null): ComposeTemplate {
  if (!days || days.length === 0) return 'PRICE_DROP';
  if (days.length >= 7) return 'PRICE_DROP';
  return 'SELECTED_DAYS';
}

export function formatDayList(days: string[]): string {
  return days
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase())
    .join(' ');
}

export function formatValidityDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function wrapWords(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (lines.length >= maxLines) break;
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function discountBadgeLines(d: ComposeDiscountInput['discount']): { off: string; value: string } {
  if (d.type === 'PERCENTAGE') {
    return { off: 'OFF', value: `${Math.round(d.value)}%` };
  }
  // Hello Paris Bold doesn't have the Bengali Taka glyph (৳), so it
  // renders as a tofu box. Use BDT prefix instead — matches the
  // caption template the owner already uses ("BDT 270").
  return { off: 'OFF', value: `BDT ${Math.round(d.value / 100)}` };
}

async function fetchImageSafe(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const fullUrl = /^https?:\/\//.test(url)
      ? url
      : `${process.env.PUBLIC_API_URL ?? 'http://localhost:3000'}${url.startsWith('/') ? '' : '/'}${url}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Render a chunk of SVG text using exactly ONE font face. The
 *  isolation is what makes resvg's matcher reliable — with multiple
 *  Hello Paris faces loaded simultaneously the matcher confuses them. */
async function renderTextLayer(
  svgBody: string,
  fontFile: string,
): Promise<Buffer> {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${svgBody}
</svg>`;
  const r = new Resvg(svg, {
    background: 'rgba(0,0,0,0)',
    font: {
      fontFiles: [fontFile],
      loadSystemFonts: false,
    },
    fitTo: { mode: 'width', value: W },
  });
  return r.render().asPng();
}

export async function composeDiscountImage(
  input: ComposeDiscountInput,
): Promise<ComposeDiscountResult> {
  const tpl = await loadTemplate();
  const template = pickTemplate(input.validity.days);
  const validDate = formatValidityDate(input.validity.endDate);
  const dayLine = template === 'SELECTED_DAYS' && input.validity.days
    ? formatDayList(input.validity.days)
    : '';
  const badge = discountBadgeLines(input.discount);

  // ─── Title block (Perandory at calmer height) ────────────────────
  // The headline used to render at 180px which Perandory's tall
  // ascenders pushed into a stretched look (taller than wide). The
  // designer's mockup uses the font at a more horizontal ratio —
  // 140px is the sweet spot.
  let titleMainSvg: string;
  let titleSubSvg: string;
  if (template === 'PRICE_DROP') {
    titleMainSvg = `
      <text x="540" y="170" font-family="${FF_PERANDORY}"
            font-size="140" text-anchor="middle" fill="#0E0E0E"
            letter-spacing="-1">PRICE DROP</text>
    `;
    titleSubSvg = `
      <text x="540" y="240" font-family="${FF_PERANDORY_COND}"
            font-size="58" text-anchor="middle" fill="#D43A1F"
            letter-spacing="6">VALID ${esc(validDate.toUpperCase())}</text>
    `;
  } else {
    // SELECTED_DAYS — three stacked lines. Small "Valid <date>" red
    // sits ABOVE the EVERY headline; day list sits BELOW. y-stops
    // chosen so the EVERY ascenders don't overlap the line above.
    titleMainSvg = `
      <text x="540" y="180" font-family="${FF_PERANDORY}"
            font-size="130" text-anchor="middle" fill="#0E0E0E"
            letter-spacing="-1">EVERY</text>
    `;
    titleSubSvg = `
      <text x="540" y="70" font-family="${FF_PERANDORY_COND}"
            font-size="36" text-anchor="middle" fill="#D43A1F"
            letter-spacing="3">VALID ${esc(validDate.toUpperCase())}</text>
      <text x="540" y="240" font-family="${FF_PERANDORY_COND}"
            font-size="56" text-anchor="middle" fill="#D43A1F"
            letter-spacing="5">${esc(dayLine.toUpperCase())}</text>
    `;
  }
  // Sub-lines (VALID / day list) use Perandory Condensed for the
  // narrower, cleaner look the designer wanted; headline uses
  // regular Perandory. They're separate render passes so resvg
  // doesn't have to disambiguate two faces of the same family.
  const titleMainLayer = await renderTextLayer(titleMainSvg, FONT_PERANDORY);
  const titleSubLayer = await renderTextLayer(titleSubSvg, FONT_PERANDORY_COND);

  // ─── Script overlay (Hello Paris Script) — bigger + centered ────
  // Centred under the food at calmer line-height. 2 lines max.
  const nameLines = wrapWords(input.productName, 22, 2);
  const scriptStartY = 920;
  const scriptLineHeight = 92;
  const scriptSvg = nameLines
    .map((line, i) => {
      const y = scriptStartY + i * scriptLineHeight;
      return `
      <text x="540" y="${y}"
            font-family="${FF_HP_SCRIPT}"
            font-size="92" fill="#0E0E0E"
            text-anchor="middle"
            transform="rotate(-6 540 ${y})">${esc(line)}</text>`;
    })
    .join('');
  const scriptLayer = await renderTextLayer(scriptSvg, FONT_HP_SCRIPT);

  // ─── Badge text (Hello Paris Bold) — sized to fit the splat ─────
  // "BDT 100" is wider than "30%", so the value font size scales
  // down for longer strings. The splat is roughly 300px across at
  // its widest; we keep ~30px of safety on each side.
  const valueFontSize = badge.value.length <= 3 ? 96
    : badge.value.length <= 6 ? 56
    : 44;
  const badgeSvg = `
    <text x="820" y="935" font-family="${FF_HP_BOLD}"
          font-size="50" text-anchor="middle" fill="#FFFFFF">${esc(badge.off)}</text>
    <text x="820" y="1015" font-family="${FF_HP_BOLD}"
          font-size="${valueFontSize}" text-anchor="middle" fill="#FFFFFF">${esc(badge.value)}</text>
  `;
  const badgeLayer = await renderTextLayer(badgeSvg, FONT_HP_BOLD);

  // ─── Address (Perandory Condensed — cleaner serif) ───────────────
  // Designer wanted "more clean front like this"; Hello Paris Regular
  // was reading as a stylised script. Perandory Condensed gives the
  // narrower, all-caps editorial look from the mockup.
  const addrLines = wrapWords(input.branding.address, 52, 2);
  const addrStartY = 1280;
  const addrLineHeight = 38;
  const addressSvg = addrLines
    .map(
      (line, i) => `
      <text x="540" y="${addrStartY + i * addrLineHeight}"
            font-family="${FF_PERANDORY_COND}"
            font-size="30" text-anchor="middle" fill="#0E0E0E"
            letter-spacing="2">${esc(line.toUpperCase())}</text>
    `,
    )
    .join('');
  const addressLayer = await renderTextLayer(addressSvg, FONT_PERANDORY_COND);
  // Suppress unused — Hello Paris Regular kept for v2 if a different
  // address style is requested later.
  void FONT_HP_REGULAR;

  // ─── Composite layers ────────────────────────────────────────────
  // bottom → top:
  //   1. template (cream background, no splat — the splat-transparent
  //      overlay below restores it on top of the food photo so the
  //      "Off X%" badge appears layered correctly).
  //   2. food photo (centred)
  //   3. splat overlay (red badge background, on top of food)
  //   4. logo (above address)
  //   5. title text
  //   6. script overlay
  //   7. badge text (white, sits on top of splat)
  //   8. address
  const composites: SharpOverlay[] = [];

  const food = await fetchImageSafe(input.foodImageUrl);
  if (food) {
    // Designer feedback: "Image should be more zoomed and large".
    // Bumped from 640 → 760 — fills the upper-middle band of the
    // canvas without crowding the title or splat.
    const FOOD_BOX = 760;
    const resized = await sharp(food)
      .resize(FOOD_BOX, FOOD_BOX, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    composites.push({
      input: resized,
      left: Math.round((W - (meta.width ?? FOOD_BOX)) / 2),
      top: 320,
    });
  }

  // Splat overlay — extracted from the same template, with cream/grey
  // pixels made transparent. Re-anchored at the same coords it was
  // extracted from so it sits exactly where the original was.
  composites.push({ input: await loadSplat(), top: 700, left: 560 });

  const logo = await fetchImageSafe(input.branding.logoUrl);
  if (logo) {
    // Designer feedback: "logo should be more clear and sharp and
    // small". Reduced from 100 → 70px tall.
    const LOGO_MAX_H = 70;
    const resized = await sharp(logo)
      .resize({ height: LOGO_MAX_H, fit: 'inside' })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    composites.push({
      input: resized,
      left: Math.round((W - (meta.width ?? 200)) / 2),
      top: 1210 - Math.round((meta.height ?? LOGO_MAX_H) / 2),
    });
  }

  composites.push({ input: titleMainLayer, top: 0, left: 0 });
  composites.push({ input: titleSubLayer, top: 0, left: 0 });
  composites.push({ input: scriptLayer, top: 0, left: 0 });
  composites.push({ input: badgeLayer, top: 0, left: 0 });
  composites.push({ input: addressLayer, top: 0, left: 0 });

  const out = await sharp(tpl)
    .resize(W, H, { fit: 'cover' })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: out, template };
}
