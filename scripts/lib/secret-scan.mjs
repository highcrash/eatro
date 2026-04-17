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

const FORBIDDEN = [
  // Brand strings — the whole reason this script exists.
  'eatro',
  'EATRO',
  'Restora',
  'restora-pos',
  '@restora.app',
  'eatrobd',
  // Internal infra — pasting prod secrets into source would be worst-case.
  'SPACES_KEY',
  'SPACES_SECRET',
  'DO_ACCESS_TOKEN',
  'DO_SPACES',
  // Signing + license secrets — only live on the packaging machine, never in git.
  'LICENSE_SIGNING_KEK',
  'LICENSE_HMAC_PEPPER',
  'KEYGEN_SECRET',
];

// Files that legitimately contain the forbidden strings (this script, plus
// this-list-itself documents). Paths are relative to the scan root and use
// forward slashes even on Windows.
const ALLOWLIST = new Set([
  'scripts/lib/secret-scan.mjs',
  'codecanyon/docs/BRANCH_HYGIENE.md',
]);

// Skip entirely — not sources we ship.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  'coverage', '.vscode', '.idea', 'release', '.do',
  // Internal artifacts that don't travel with the codecanyon branch anyway.
  'mockups', 'temporary screenshots',
  // Claude Code local state (settings, skills, local plans) — never ships.
  '.claude',
]);

// Skip files by name regardless of directory.
const IGNORE_FILES = new Set([
  // Local dev env files; never tracked, never shipped, but may exist on disk.
  '.env', '.env.local',
  // Lockfiles — benign to scan but noisy when brand strings appear in
  // transitive dep metadata.
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
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
      // Case-sensitive match — brand tokens like "EATRO" vs "eatro" are
      // both forbidden but we want them reported distinctly if they hit.
      const idx = content.indexOf(needle);
      if (idx < 0) continue;
      const lineNo = content.slice(0, idx).split('\n').length;
      hits.push({ file: relPath, token: needle, line: lineNo });
    }
  }

  return { hits, scannedFiles };
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
