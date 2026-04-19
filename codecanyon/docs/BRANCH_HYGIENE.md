# Branch hygiene — `codecanyon` fork

The `codecanyon` branch is the sellable edition of Restora POS. It exists in the same
repo as `main` (internal) but must never leak internal code or be merged backwards.

## Golden rules

1. **Merges flow one way: `main` → `codecanyon`. Never the reverse.**
2. **Force-push is forbidden on `codecanyon`.** Enable branch protection on GitHub.
3. **Internal secrets, deploy specs, and screenshot scripts stay on `main` only.**
   They are gitignored on `codecanyon` (see `.gitignore` near the bottom of the
   file — look for the `# codecanyon fork — main-only files` marker).
4. **Packaged releases are cut only from `codecanyon`.** The packager script
   (`scripts/package-codecanyon.mjs`) asserts `git branch` = `codecanyon` before
   doing anything.

## Weekly merge workflow

Run this every Monday (or before cutting a release):

```bash
# 1. pull both sides
git fetch origin
git checkout main && git pull --ff-only
git checkout codecanyon && git pull --ff-only

# 2. merge main into codecanyon (no fast-forward so the merge commit is visible)
git merge main --no-ff

# 3. resolve conflicts. Expected conflict files:
#    - prisma/seed.ts                       (codecanyon default variant differs)
#    - apps/admin/src/App.tsx               (install-wizard takeover)
#    - apps/api/src/app.module.ts           (LicenseModule, InstallModule, UpdaterModule)
#    - apps/api/src/public/public.controller.ts  (un-branded OG)
#    - apps/pos-desktop/electron-builder.yml      (parameterized brand)
#    - README.md                            (buyer-facing on codecanyon)
#    Anything outside that list → read carefully before accepting.

# 3b. If any of the main-only files listed in .gitignore's "codecanyon fork"
#     section resurface after the merge (gitignore doesn't block merge
#     content — only `git add`), remove them again before pushing:
#       git rm -rf --cached .do/
#       for f in scripts/screenshot*.mjs scripts/seed-attendance.mjs scripts/seed-sales.mjs; do
#         [ -f "$f" ] && git rm --cached "$f"
#       done
#       git commit -m "chore(codecanyon): strip internal files resurrected by merge"

# 4. before pushing, confirm internal leaks are gone
pnpm run codecanyon:secret-scan

# 5. push
git push origin codecanyon
```

## What lives ONLY on `codecanyon` (never on `main`)

- `apps/api/src/license/` — license gate module
- `apps/api/src/install/` — install wizard endpoints
- `apps/api/src/updater/` — in-app updater
- `apps/api/src/system-config/` — brand/site config
- `prisma/seeds/` — split seed variants
- `docs/codecanyon-landing.html` — marketing page
- `codecanyon/docs/` — buyer-facing docs (this file)
- `scripts/package-codecanyon.mjs`, `scripts/strip-branding.mjs`, `scripts/lib/*`
- `docker-compose.yml` — buyer-facing (the internal one lives in `infra/`)
- `install.sh`, `LICENSE.txt`, and a rewritten `README.md`

## What lives ONLY on `main` (never on `codecanyon`)

Listed in `.gitignore` under the codecanyon section. Currently:

- `.do/app.yaml` — internal deploy spec for example.com
- `scripts/screenshot.mjs`, `scripts/screenshot-pos.mjs`, `scripts/seed-attendance.mjs`, `scripts/seed-sales.mjs` — internal scripts
- `mockups/`, `temporary screenshots/` — internal design artifacts
- `apps/license-server/` — self-hosted license server (internal infra
  running at `license.<your-domain>`). A buyer with the server code
  could stand up their own license server and bypass ours. This is the
  single most important path to keep off `codecanyon`.
- `apps/license-admin/` — admin UI for the license server (same reasoning)

If you add a new internal-only file, update both:
1. Root `.gitignore` (the codecanyon section)
2. This document's list

## Secret-scan safety net

`scripts/lib/secret-scan.mjs` greps the working tree (or the zip at package time)
and fires on two kinds of hits:

**1. Brand strings** — literal tokens that should never appear in shipped source:
`eatro`, `EATRO`, `Restora`, `restora-pos`, `@example.com`, `eatrobd`.

**2. Value-shape patterns** — regex rules that catch accidental secret leaks
regardless of variable name:
- DigitalOcean Spaces access keys (pattern `DO[A-Z0-9]{18,22}`)
- bcrypt hashes (`$2a$…` / `$2b$…`)
- Base64-looking value assigned to a known secret env var
  (`LICENSE_SIGNING_KEK=<real>`, `JWT_SECRET=<real>`, etc. —
  the placeholder `CHANGE_ME_*` is specifically allowed).

The scanner deliberately does NOT flag variable NAMES — those appear
legitimately in `.env.example` files, schema comments, and docs.

It fails the build on any hit. Run manually with:

```bash
pnpm run codecanyon:secret-scan
# or scan a specific dir (e.g. a staged release tree):
node scripts/lib/secret-scan.mjs ./release/codecanyon-v1.0.0/
```

### When is the scan expected to be clean?

- **At package time** (scanning `release/codecanyon-*/`): MUST be clean.
  The packager script fails if not.
- **Mid-development on `codecanyon`**: may report brand-string hits in
  source files that Section 5 (un-branding codemod) hasn't reached yet.
  That's a baseline to work down, not a release blocker.
- **On `main`**: not meaningful — main contains the internal license
  server and internal deploy config, both of which legitimately mention
  secret env-var names and are never packaged for buyers.

## Release cadence

- `codecanyon` tracks roughly one minor release per month (`v1.0.0`, `v1.1.0`, …).
- Bugfix releases (`v1.0.1`) happen whenever a buyer reports something critical.
- Each release: bump `apps/api/package.json` version, run packager, upload zip
  to CodeCanyon + attach to GitHub release.
