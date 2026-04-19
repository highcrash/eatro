#!/usr/bin/env node
/**
 * Secret + brand scanner for the codecanyon fork.
 *
 * Runs against either the working tree (default, pre-commit) or a provided
 * directory (at package time, scanning the staged release tree or the zip
 * extract). Any hit fails the process with exit code 1.
 *
 * Usage:
 *   node scripts/lib/secret-scan.mjs                 # scans the repo root
 *   node scripts/lib/secret-scan.mjs ./release/...   # scans a specific dir
 *
 * Why not just `grep -r`? Portability (no grep on default Windows shells),
 * consistent exit codes in CI, and the ability to add allowlisted files
 * (e.g. this scanner file itself MUST contain the strings it searches for).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { argv, exit, cwd } from 'node:process';

// The scanner fires on *literal occurrences* of these tokens. Only include
// strings whose presence ANYWHERE in the shipped tree is a bug — i.e. brand
// leakages and values that should never live outside a secret store.
//
// Variable NAMES like `LICENSE_SIGNING_KEK` / `SPACES_KEY` aren't in this
// list: they appear legitimately in .env.example, schema comments, and
// docs. Leaked VALUES are what matter, and those are caught by the
// pattern-based rules below.
const FORBIDDEN = [
  // Brand strings — the primary target. Any hit in the release zip is a bug.
  'eatro',
  'EATRO',
  'Restora',
  'restora-pos',
  '@restora.app',
  'eatrobd',
];

// Regex rules run against the same file contents. Each match reports like
// a FORBIDDEN hit. Use these for value-shape detection (e.g. bcrypt
// hashes or obvious DO access tokens) where a literal token list can't.
const FORBIDDEN_PATTERNS = [
  // DigitalOcean Spaces access keys — always 20 char uppercase starting
  // with "DO". This catches raw key leaks into source; the env-var NAME
  // `SPACES_KEY` is fine to mention in docs and won't match this pattern.
  { label: 'DO Spaces access key (value)', re: /\bDO[0-9A-Z]{18,22}\b/ },
  // Bcrypt hashes — `$2[aby]$<cost>$<22+53 base64>`. Useful for catching
  // ADMIN_PASSWORD_HASH=<real-hash> accidentally committed.
  { label: 'bcrypt hash (value)', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/ },
  // Base64-ish secrets > 32 chars assigned to a known secret env var.
  // Matches things like `LICENSE_SIGNING_KEK=V2hh....==` but not the
  // `CHANGE_ME_base64_32_bytes` placeholder.
  { label: 'base64 secret assignment', re: /\b(LICENSE_SIGNING_KEK|LICENSE_HMAC_PEPPER|LICENSE_ADMIN_JWT_SECRET|JWT_SECRET|JWT_REFRESH_SECRET|KEYGEN_SECRET|ENVATO_PERSONAL_TOKEN)\s*=\s*(?!CHANGE_ME|")[A-Za-z0-9+/=_\-.]{24,}/ },
];

// Files that legitimately contain the forbidden strings (this script, plus
// this-list-itself documents). Paths are relative to the scan root and use
// forward slashes even on Windows.
const ALLOWLIST = new Set([
  'scripts/lib/secret-scan.mjs',
  'codecanyon/docs/BRANCH_HYGIENE.md',
  // Codemod that REPLACES brand strings; the patterns live here as
  // string literals so the file legitimately contains them.
  'scripts/strip-branding.mjs',
  // Placeholder seed that documents (in comments) what was stripped
  // from the legacy seed.ts. Not user-facing.
  'prisma/seeds/demo-full.ts',
  // Internal dev-only docker compose. The buyer's zip ships its own
  // generic compose at infra/<buyer-deploy>/docker-compose.yml and
  // does NOT include these files. Section 8 packager filter excludes
  // the whole infra/ tree EXCEPT the per-deploy subdirectory.
  'infra/docker-compose.yml',
  'infra/init-db.sql',
  // License-gate constants: product SKU must match the server-side
  // record. Deliberate, not a leak.
  'apps/api/src/license/license.constants.ts',
]);

// Skip entirely — not sources we ship.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  'coverage', '.vscode', '.idea', 'release', '.do',
  // Internal artifacts that don't travel with the codecanyon branch anyway.
  'mockups', 'temporary screenshots',
  // Claude Code local state (settings, skills, local plans) — never ships.
  '.claude',
  // Prisma client generated output (e.g. apps/license-server/src/generated/).
  // Always gitignored, regenerated on each build.
  'generated',
]);

// Skip files by name regardless of directory.
const IGNORE_FILES = new Set([
  // Local dev env files; never tracked, never shipped, but may exist on disk.
  '.env', '.env.local',
  // Lockfiles — benign to scan but noisy when brand strings appear in
  // transitive dep metadata.
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  // Internal main-only deploy notes. Gitignored on codecanyon but the
  // file stays on disk in mixed-branch checkouts.
  'DEPLOYMENT.md',
]);

// Only scan text-like files; binaries can't contain readable secrets for
// our purposes and slow the walk down.
const TEXT_EXTS = /\.(m?[jt]sx?|json|ya?ml|md|html?|css|scss|sql|prisma|sh|toml|env(\.example)?|txt|xml|svg)$/i;

async function* walk(dir, rootAbs) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, rootAbs);
    } else if (entry.isFile() && TEXT_EXTS.test(entry.name)) {
      if (IGNORE_FILES.has(entry.name)) continue;
      const relPath = relative(rootAbs, full).split(sep).join('/');
      if (ALLOWLIST.has(relPath)) continue;
      yield { full, relPath };
    }
  }
}

async function scan(root) {
  const rootAbs = await stat(root).then((s) => {
    if (!s.isDirectory()) throw new Error(`not a directory: ${root}`);
    return root;
  });

  const hits = [];
  let scannedFiles = 0;

  for await (const { full, relPath } of walk(rootAbs, rootAbs)) {
    const content = await readFile(full, 'utf8').catch(() => null);
    if (content == null) continue;
    scannedFiles++;

    for (const needle of FORBIDDEN) {
      // Case-sensitive, word-boundaried match. Plain indexOf() falsely
      // hits substrings inside third-party enum names like
      // `UseScrollRestoration` (react-router) → `Restora`. Wrapping in
      // a regex with explicit word boundaries (or punctuation/quote
      // delimiters) keeps the false-positive rate near zero.
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegex(needle)}(?:[^A-Za-z0-9_]|$)`);
      const m = re.exec(content);
      if (!m) continue;
      const lineNo = content.slice(0, m.index).split('\n').length;
      hits.push({ file: relPath, token: needle, line: lineNo });
    }
    for (const { label, re } of FORBIDDEN_PATTERNS) {
      const match = re.exec(content);
      if (!match) continue;
      const lineNo = content.slice(0, match.index).split('\n').length;
      hits.push({ file: relPath, token: label, line: lineNo });
    }
  }

  return { hits, scannedFiles };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const target = argv[2] ? argv[2] : cwd();
const { hits, scannedFiles } = await scan(target);

if (hits.length === 0) {
  console.log(`[secret-scan] clean — scanned ${scannedFiles} text files under ${target}`);
  exit(0);
}

console.error(`[secret-scan] FAILED — ${hits.length} forbidden token hit(s) in ${scannedFiles} files:\n`);
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}  →  ${hit.token}`);
}
console.error(`\nEither remove the token, or if it legitimately belongs (e.g. docs describing what`);
console.error(`the scanner looks for), add the file path to the ALLOWLIST in scripts/lib/secret-scan.mjs.`);
exit(1);
