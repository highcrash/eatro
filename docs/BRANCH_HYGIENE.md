# Branch Hygiene (contributor doc, not in the buyer zip)

This doc lives on the `codecanyon` branch and documents the rules
for keeping the branch clean. If you're a buyer, you can ignore
this file — the packager excludes it from the release zip.

## Rules

1. **main → codecanyon only.** Never merge codecanyon back into
   main. The two branches diverge deliberately: codecanyon has the
   license gate + install wizard + un-branded strings; main has the
   internal brand + dev shortcuts.

2. **Merge weekly.** Long divergence ⇒ painful merges. Every Friday
   (or before any release), `git checkout codecanyon && git merge
   main --no-ff`.

3. **Re-run scrubbers after every merge.** `main` always ships
   internal brand strings; the merge brings them in. Run:
   ```
   node scripts/strip-branding.mjs
   node scripts/lib/secret-scan.mjs
   ```
   Commit the results with message `chore(codecanyon): post-merge
   scrub`.

4. **Internal-only files are gitignored on codecanyon.** If the
   working tree has them, `.gitignore` keeps them from being
   staged. Current list:
   - `.do/` (DO App Platform specs)
   - `DEPLOYMENT.md` (internal deploy notes)
   - `mockups/`
   - `temporary screenshots/`
   - `apps/license-server/` + `apps/license-admin/` (these live in
     a separate repo: `github.com/<org>/neawaslic`)
   - Assorted internal `scripts/seed-*.mjs`, `screenshot.mjs`, etc.

5. **Secrets never commit.** The pre-commit hook runs `node
   scripts/lib/secret-scan.mjs` — if it fires, fix the leak before
   committing.

6. **Packager refuses to run on the wrong branch.** `pnpm
   codecanyon:package` checks `git rev-parse --abbrev-ref HEAD`
   first; any value other than `codecanyon` aborts the build.

## Weekly merge checklist

```
git fetch origin
git checkout codecanyon
git merge origin/main --no-ff
# resolve conflicts — most common: package.json (brand name, scripts)
node scripts/strip-branding.mjs          # re-scrub
node scripts/lib/secret-scan.mjs          # must be clean
pnpm install
pnpm exec turbo run build --filter='!@restora/pos-desktop'
pnpm --filter @restora/api test           # smoke
git add -A && git commit -m "chore(codecanyon): merge main + rescrub"
git push origin codecanyon
```

## Common merge conflicts + resolutions

| File | Typical resolution |
| ---- | ----------------- |
| `package.json` | keep codecanyon's `name` (`your-restaurant-pos`), take main's dep/script additions |
| `prisma/schema.prisma` | usually no conflict; schema changes are additive |
| `.gitignore` | keep codecanyon's longer list (superset of main's) |
| `prisma/seed.ts` | keep codecanyon's dispatcher shape (Section 4); take any new variants from main |
| `apps/web/index.html` | keep codecanyon's `<title>Your Restaurant</title>` |
