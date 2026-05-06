---
name: rebuild-pos-desktop
description: >
  Use this skill whenever the user asks to "rebuild the desktop app", "ship a new
  pos-desktop version", "release pos-desktop", "bump the desktop installer",
  "publish a new desktop build", or any equivalent. Also use it when shared code
  the desktop bundles (apps/pos-desktop/src/main/*, packages/utils, packages/types,
  apps/pos/src — the renderer reuse path) has changed and installed terminals need
  to pick up the change.
  Two-branch shop: `main` ships the `stable` channel (Restora POS, 2.x), `codecanyon`
  ships the `codecanyon` channel (Your Restaurant POS, 1.x). They MUST stay isolated
  — without isolation, GitHub `/releases/latest` returns whichever was published
  last, and the wrong-channel desktop tries to pull a yml that isn't there
  (the classic "Cannot find stable.yml in the latest release artifacts" 404).
  Trigger: user says "rebuild desktop", "tag pos-desktop", "publish pos-desktop",
  "ship desktop X.Y.Z", or anything similar.
---

# Rebuild & Release pos-desktop — Operational Runbook

This file is the authoritative checklist for cutting a new pos-desktop build.
Follow it top-to-bottom; do not skip the verification step at the end.

## TL;DR — the four moves

For each branch you're shipping:

1. **Bump version** in `apps/pos-desktop/package.json` (main → 2.x.y, codecanyon → 1.x.y).
2. **Append CHANGELOG entry** explaining what shipped + whether bundled API changes are also riding along.
3. **Commit + push the branch + push the tag**: `git tag pos-desktop-v{version} && git push origin pos-desktop-v{version}`.
4. **Verify after CI finishes** — run the verification block at the bottom of this file. If `/releases/latest` resolves to anything other than the most recent `main` release, the codecanyon release wasn't flipped to prerelease — fix it.

## Why channel isolation is non-negotiable

`electron-updater` reads `https://github.com/<owner>/<repo>/releases/latest` to
decide what version to install. GitHub's `/releases/latest` ignores releases
marked `prerelease: true`. If a codecanyon release is published as a regular
release (prerelease=false), GitHub returns IT as `latest`, and the main desktop
(channel: stable) tries to fetch `stable.yml` from THAT release — which only
contains `codecanyon.yml`. Result: "Cannot find stable.yml in the latest release
artifacts" 404.

Defense in depth — two lines of protection:

1. `apps/pos-desktop/electron-builder.yml` on codecanyon has
   `releaseType: prerelease`. The CI publishes the release with `prerelease=true`
   from the start.
2. After CI finishes, **always verify** with `gh api .../releases/latest` that
   the resolved release is the most recent `main` (stable) release. If it's the
   codecanyon one, manually flip it via `gh api -X PATCH`.

Channel mapping locked in as of 2026-05-06:

| Branch       | Major | Channel      | yml file              | Release type |
| ------------ | ----- | ------------ | --------------------- | ------------ |
| `main`       | 2.x   | `stable`     | `stable.yml`          | release      |
| `codecanyon` | 1.x   | `codecanyon` | `codecanyon.yml`      | prerelease   |

NEVER cross-version (don't bump codecanyon above main or vice versa). The major
split is also a useful eyeball signal in GitHub Releases.

## Step 1 — Bump version

### Main branch (stable channel)

```pwsh
git checkout main
# Edit apps/pos-desktop/package.json:
#   "version": "2.0.X" → "2.0.Y"   (semver patch)
```

### Codecanyon branch (codecanyon channel)

```pwsh
git checkout codecanyon
# Edit apps/pos-desktop/package.json:
#   "version": "1.0.X" → "1.0.Y"   (semver patch)
```

Use the `Edit` tool against the `"version": "X.Y.Z"` literal (it's at line 3
of the file). DO NOT use `npm version` — it triggers git operations the harness
hasn't been authorised for.

## Step 2 — Append CHANGELOG entry

`apps/pos-desktop/CHANGELOG.md`. New entry goes at the TOP, under the
`Versioning follows SemVer` heading. Format:

```markdown
## {VERSION} — {SHORT TITLE} ({YYYY-MM-DD})

{1-3 sentence summary of what shipped — desktop changes specifically.}

- Bullet 1 — what's new in the desktop main process / shared util it bundles.
- Bullet 2 — admin/UI changes ride along automatically, but mention the big ones.

{If bundled API rebundle: one paragraph listing the API fixes that ship with
this build. None of those need a desktop rebuild on their own — explain so
future-you doesn't re-bump the desktop just because the API updated.}
```

## Step 3 — Commit, push, tag

```pwsh
git add apps/pos-desktop/package.json apps/pos-desktop/CHANGELOG.md
git commit -m "chore(pos-desktop): bump {main|codecanyon} to {version} — {short reason}"
git push origin {branch}
git tag pos-desktop-v{version}
git push origin pos-desktop-v{version}
```

The tag push triggers the GitHub Actions workflow that runs:

1. `pnpm install` (frozen lockfile)
2. `pnpm --filter @restora/utils build` (because `kitchen-ticket.ts` and others are bundled)
3. `pnpm --filter @restora/pos-desktop dist` — runs `electron-rebuild` for
   better-sqlite3, then `electron-vite build`, then `electron-builder --win`.
4. Uploads `RestoraPOS-Setup-{version}.exe` (main) or
   `YourRestaurantPOS-Setup-{version}.exe` (codecanyon) + `{channel}.yml` +
   `.blockmap` to a new GitHub release named `pos-desktop-v{version}`.

Watch progress at https://github.com/highcrash/eatro/actions . Both branches
typically finish in 5–8 minutes.

## Step 4 — Verify (THE PART YOU CAN'T SKIP)

After CI is green on BOTH branches you intended to release, run this block
and check each line:

```pwsh
$gh = "C:/Program Files/GitHub CLI/gh.exe"

# 1. Each tag has the right asset list.
& $gh api repos/highcrash/eatro/releases/tags/pos-desktop-v{MAIN_VERSION} --jq '{tag_name, prerelease, assets: [.assets[].name]}'
# Expect: prerelease=false, assets include RestoraPOS-Setup-{ver}.exe + stable.yml.

& $gh api repos/highcrash/eatro/releases/tags/pos-desktop-v{CC_VERSION} --jq '{tag_name, prerelease, assets: [.assets[].name]}'
# Expect: prerelease=TRUE, assets include YourRestaurantPOS-Setup-{ver}.exe + codecanyon.yml.

# 2. /releases/latest resolves to the main (stable) release, NOT the codecanyon one.
& $gh api repos/highcrash/eatro/releases/latest --jq '{tag_name, prerelease, assets: [.assets[].name]}'
# Expect: tag_name = pos-desktop-v{MAIN_VERSION} (or the bare v{MAIN_VERSION} alias),
#         prerelease=false,
#         assets include stable.yml.
# If it returns the codecanyon tag → see "Recovery" below.
```

## Recovery — codecanyon release wasn't flipped to prerelease

Symptom from a user's installed terminal:
> `Cannot find stable.yml in the latest release artifacts (https://github.com/highcrash/eatro/releases/download/pos-desktop-v1.0.X/stable.yml): HttpError: 404`

Or `gh api .../releases/latest` returns the codecanyon tag.

Fix in one shot — flip ONLY the offending codecanyon release to prerelease.
Do NOT touch the main release.

```pwsh
$gh = "C:/Program Files/GitHub CLI/gh.exe"

# 1. Get the release id from its tag.
$rid = & $gh api repos/highcrash/eatro/releases/tags/pos-desktop-v{CC_VERSION} --jq '.id'

# 2. Flip prerelease=true.
& $gh api -X PATCH "repos/highcrash/eatro/releases/$rid" -f prerelease=true --jq '{tag_name, prerelease}'

# 3. Verify /releases/latest now returns the main release.
& $gh api repos/highcrash/eatro/releases/latest --jq '{tag_name, prerelease}'
```

Affected installs auto-recover on the next launch — `electron-updater` retries
on every poll, the next poll hits the corrected `/releases/latest`, downloads
`stable.yml`, and the silent toast "Update available" appears. The user does
nothing. No reinstall needed.

If multiple historical codecanyon releases need flipping in bulk (e.g. a fresh
clone of the workflow that didn't have the prerelease flag), loop through the
tags:

```pwsh
$gh = "C:/Program Files/GitHub CLI/gh.exe"
foreach ($t in @("pos-desktop-v1.0.56","pos-desktop-v1.0.57", ... ,"pos-desktop-v1.0.77")) {
  $rid = & $gh api "repos/highcrash/eatro/releases/tags/$t" --jq '.id'
  & $gh api -X PATCH "repos/highcrash/eatro/releases/$rid" -f prerelease=true --jq '{tag_name, prerelease}'
}
```

## Decision tree — do I need to rebuild the desktop AT ALL?

Many backend-only changes do NOT require a desktop rebuild because the desktop
loads the deployed web POS (`apps/pos`) as its renderer. Use this filter:

| Change touches…                                                  | Desktop rebuild? |
| ---------------------------------------------------------------- | ---------------- |
| `apps/api/**`                                                    | NO               |
| `apps/admin/**`                                                  | NO               |
| `apps/qr-order/**`                                               | NO               |
| `apps/web/**`                                                    | NO               |
| `apps/kds/**`                                                    | NO               |
| `apps/pos/**` (web POS renderer code reused by desktop)          | NO\*             |
| `apps/pos-desktop/src/main/**` (Electron main process)           | **YES**          |
| `apps/pos-desktop/src/preload/**` (contextBridge)                | **YES**          |
| `apps/pos-desktop/src/renderer/**` (desktop-only screens)        | **YES**          |
| `packages/utils/**` (bundled into main process)                  | **YES**          |
| `packages/types/**` (compile-time only — but rebuild for safety) | YES              |
| `prisma/schema.prisma`                                           | NO\*\*           |

\* Web POS code is served from the API host. Desktop loads it via
`BrowserWindow#loadURL`. Edits ship the moment the API + web POS deploy.

\*\* Schema lives server-side; the desktop never touches Prisma directly.
Rebuild only if `@restora/types` changed shape AND a desktop main-process
file (e.g. an IPC handler) reads the new field.

When in doubt: if `apps/pos-desktop/src/main/**` or `packages/utils/**` shows
in your `git diff`, BUMP. Otherwise, ask the user — don't unilaterally rebuild
because rebuilds cost time, churn, and a forced auto-update on every terminal.

## Common gotchas to surface to the user

1. **"Should I bump?"** — Quote the decision tree above and let the user choose.
   Never assume; rebuilds are expensive in operator goodwill.
2. **"Do both branches need a bump?"** — Only if both branches actually changed.
   You can ship just main without codecanyon, or vice versa. Each branch is
   independent.
3. **CI failed during `electron-rebuild better-sqlite3`** — almost always a
   Node version mismatch. The workflow pins Node 22; check
   `.github/workflows/pos-desktop-release.yml` if it changed.
4. **CI succeeded but the release has no `.exe`** — electron-builder's
   `npmRebuild: false` failed silently because the workspace symlink resolution
   choked. Re-run the workflow from the Actions UI; it's idempotent.

## What this skill does NOT do

- Doesn't run the rebuild locally — CI does that on Linux runners. Don't try to
  build the .exe on the user's Windows machine "to test"; the artifact CI ships
  is the artifact users get.
- Doesn't push without confirmation. Bumping desktop versions is a "force update
  every cashier terminal in the field" action — always summarise the diff and
  the version bump, then wait for the user's explicit "yes" before tagging
  and pushing.
- Doesn't touch un-prefixed tags (`v2.0.12` etc) — the CI publishes BOTH
  `v{version}` and `pos-desktop-v{version}` and they share artifacts; no
  cleanup needed.
