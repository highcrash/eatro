#!/usr/bin/env node
// Codemod that removes user-facing internal brand strings from the
// codecanyon source tree. Run before the packager (Section 8).
//
// DOES NOT modify:
//   - scripts/strip-branding.mjs (this file) — it contains the brand
//     patterns as regex literals BY DESIGN, so running the codemod
//     on itself would rewrite them into no-ops. Self-exclusion below.
//   - scripts/lib/secret-scan.mjs — same reason; it lists the
//     forbidden tokens as patterns.
//   - prisma/ seed files — those have their own neutralised content
//     via the demo-light / demo-full split (Section 4).
//   - codecanyon/docs/, DEPLOYMENT.md, mockups/ — internal-only docs
//     that never reach the buyer's zip (gitignored on codecanyon or
//     filtered out by the packager).
//
// Pass --check for a non-zero exit if any pattern matches (CI gate).
// Pass --dry for a human-readable preview.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html', '.json']);
// .md explicitly omitted — documentation files that reference the
// internal brand (codecanyon/docs/, DEPLOYMENT.md) are already excluded
// from the buyer's zip by the packager. Scrubbing them in place would
// nuke the rationale captions from internal docs for no gain.

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.turbo', 'coverage',
  'prisma', 'codecanyon', 'mockups',
]);

const EXCLUDE_FILES = new Set([
  // Self-exclusion — brand patterns live here as regex literals.
  'scripts/strip-branding.mjs',
  'scripts/lib/secret-scan.mjs',
  // Main-only deploy doc; gitignored on codecanyon but still on disk
  // in mixed working trees.
  'DEPLOYMENT.md',
]);

// Intentionally targeted — NOT a broad /EATRO/g because the grep
// matches class names (RestoraPosGateway, etc) that ARE NOT user-
// facing brand leaks.
const REPLACEMENTS = [
  // User-facing fallback strings in `someVar || 'EATRO'` expressions.
  { pat: String.raw`'EATRO'`, rep: `'Your Restaurant'` },
  { pat: String.raw`"EATRO"`, rep: `"Your Restaurant"` },
  // SEO placeholders in the admin WebsitePage.
  { pat: String.raw`placeholder="EATRO Restaurant"`, rep: `placeholder="Your Restaurant"` },
  { pat: String.raw`placeholder="Menu — EATRO"`, rep: `placeholder="Menu"` },
  { pat: String.raw`placeholder="About Us — EATRO"`, rep: `placeholder="About Us"` },
  { pat: String.raw`placeholder="Contact — EATRO"`, rep: `placeholder="Contact"` },
  { pat: String.raw`placeholder="Book a Table — EATRO"`, rep: `placeholder="Book a Table"` },
  // @restora.app user-facing emails. NPM scope (@restora/) is different
  // and preserved; the regex below only matches the dot-app TLD.
  { pat: String.raw`@restora\.app`, rep: '@example.com' },
  // Bangladesh phone format used in seed fallbacks + UI placeholders.
  { pat: String.raw`"01\d{9}"`, rep: '"+10000000000"' },
  { pat: String.raw`'01\d{9}'`, rep: "'+10000000000'" },
  // Domain fallbacks. Env-driven URLs already override at runtime;
  // hardcoded fallbacks shouldn't ship.
  { pat: String.raw`https://eatrobd\.com`, rep: 'https://example.com' },
  { pat: String.raw`https://(admin|pos|kds|qr|api|order|www)\.eatrobd\.com`, rep: 'https://$1.example.com' },
  { pat: String.raw`eatrobd\.com`, rep: 'example.com' },
  // password123 is the internal dev seed default; not allowed in prod zips.
  { pat: String.raw`"password123"`, rep: '"change-me-on-first-login"' },
  { pat: String.raw`'password123'`, rep: "'change-me-on-first-login'" },
  // ─── User-facing string fallbacks ────────────────────────────────
  // 'Restora' / "Restora" used as a default brand name in receipts,
  // headers, and HTML titles. NOT touching `Restora` inside class
  // names (RestoraPosGateway etc) — those are guarded by quote chars.
  { pat: String.raw`'Restora POS'`, rep: `'Your Restaurant POS'` },
  { pat: String.raw`"Restora POS"`, rep: `"Your Restaurant POS"` },
  { pat: String.raw`'Restora'`, rep: `'Your Restaurant'` },
  { pat: String.raw`"Restora"`, rep: `"Your Restaurant"` },
  // HTML titles (admin/pos/kds/qr index.html etc).
  { pat: String.raw`<title>Restora([^<]*)</title>`, rep: '<title>Your Restaurant$1</title>' },
  // PWA manifest names + product titles in electron-builder.
  { pat: String.raw`name: 'Restora ([^']*)'`, rep: `name: 'Your Restaurant $1'` },
  { pat: String.raw`name: "Restora ([^"]*)"`, rep: `name: "Your Restaurant $1"` },
  // File-header doc comments like "// ─── Restora POS — order service"
  // — strip the brand prefix; keep the rest of the description.
  { pat: String.raw`// ─── Restora POS —`, rep: '// ───' },
  { pat: String.raw`// Restora POS —`, rep: '//' },
  { pat: String.raw`# Restora POS —`, rep: '#' },
  { pat: String.raw`# Restora POS\b`, rep: '# Restaurant POS' },
  // Zustand persist keys, ipcMain channels — namespace was 'restora-pos'.
  { pat: String.raw`'restora-pos-([a-z-]+)'`, rep: `'rp-$1'` },
  { pat: String.raw`"restora-pos-([a-z-]+)"`, rep: `"rp-$1"` },
];

function compile(r) {
  // The `regex: true` escape-hatch is for patterns with capture groups
  // ($1 etc). Plain strings become literal regex (all metacharacters
  // escaped at the source level — our patterns here only use . and \
  // inside character classes, which String.raw already handles).
  return new RegExp(r.pat, 'g');
}

const args = new Set(process.argv.slice(2));
const MODE = args.has('--check') ? 'check' : args.has('--dry') ? 'dry' : 'apply';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walk(abs);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (INCLUDE_EXTS.has(ext)) yield abs;
    }
  }
}

const changes = [];
for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (EXCLUDE_FILES.has(rel)) continue;
  const before = readFileSync(file, 'utf8');
  let after = before;
  const fileChanges = [];
  for (const r of REPLACEMENTS) {
    const pat = compile(r);
    const next = after.replace(pat, r.rep);
    if (next !== after) {
      const matches = after.match(pat);
      if (matches) fileChanges.push({ pat: r.pat, count: matches.length });
      after = next;
    }
  }
  if (after !== before) {
    changes.push({ rel, fileChanges });
    if (MODE === 'apply') writeFileSync(file, after, 'utf8');
  }
}

if (changes.length === 0) {
  console.log('strip-branding: no brand strings found — clean');
  process.exit(0);
}

console.log(`strip-branding: ${MODE === 'apply' ? 'applied' : MODE === 'dry' ? 'would apply' : 'detected'} changes in ${changes.length} files`);
for (const c of changes) {
  console.log(`  ${c.rel}`);
  if (MODE !== 'apply') {
    for (const fc of c.fileChanges) console.log(`      ${fc.pat} × ${fc.count}`);
  }
}

if (MODE === 'check') process.exit(changes.length > 0 ? 2 : 0);
