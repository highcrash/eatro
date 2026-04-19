#!/usr/bin/env node
// scripts/package-codecanyon.mjs — build the buyer's zip.
//
// Pipeline:
//   1. Sanity: refuse to run on any branch but `codecanyon`.
//   2. `pnpm install --frozen-lockfile` + `turbo run build`.
//   3. Stage release/<name>-vX.Y.Z/ with:
//        api/         apps/api/dist + prod node_modules + prisma
//        admin/, pos/, kds/, qr-order/, web/   each apps/<x>/dist
//        prisma/      schema + migrations + seed dispatcher
//        docs/        codecanyon-landing.html + the docs/*.md
//        infra/       buyer-deploy compose + nginx + caddy templates
//        manifest.json, manifest.sig (signed)
//        docker-compose.yml, install.sh, README.md, LICENSE.txt, .env.example
//   4. Run scripts/strip-branding.mjs --check on the staged tree
//      → fail build if any internal brand string snuck through.
//   5. Run scripts/lib/secret-scan.mjs on the staged tree → same.
//   6. Sign the manifest (scripts/lib/sign-manifest.mjs).
//   7. Zip the staging dir → release/<name>-vX.Y.Z.zip.
//
// Output goes under release/ (gitignored). Re-running is safe — the
// stage dir is rm'd up front.
//
// Skip a stage with --skip-build / --skip-scan etc for fast iteration.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const args = new Set(process.argv.slice(2));
const skip = (k) => args.has(`--skip-${k}`);

function step(label, fn) {
  console.log(`\n──── ${label} ────`);
  return fn();
}

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function shJson(cmd) {
  return JSON.parse(execSync(cmd, { cwd: ROOT, encoding: 'utf8' }));
}

step('preflight', () => {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (branch !== 'codecanyon') {
    console.error(`refuse to package: current branch is "${branch}", expected "codecanyon"`);
    console.error('git checkout codecanyon, then re-run.');
    process.exit(2);
  }
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  global.__VERSION__ = rootPkg.version;
  global.__NAME__ = rootPkg.name;
  console.log(`branch=${branch}  name=${rootPkg.name}  version=${rootPkg.version}`);
});

const RELEASE_NAME = `${global.__NAME__}-v${global.__VERSION__}`;
const STAGE = join(ROOT, 'release', RELEASE_NAME);
const ZIP = join(ROOT, 'release', `${RELEASE_NAME}.zip`);

step('clean release dir', () => {
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
  mkdirSync(STAGE, { recursive: true });
});

if (!skip('build')) {
  step('install + build', () => {
    sh('pnpm install --frozen-lockfile');
    sh("pnpm exec turbo run build --filter=!@restora/pos-desktop");
  });
}

if (!skip('strip')) {
  step('strip-branding (working tree, before stage)', () => {
    sh('node scripts/strip-branding.mjs --check');
  });
}

step('stage app artefacts', () => {
  // API runtime: dist + the workspace package.json (so pnpm prod-deploy
  // can install just what the API needs at install time).
  cpSync(join(ROOT, 'apps/api/dist'), join(STAGE, 'api/dist'), { recursive: true });
  cpSync(join(ROOT, 'apps/api/package.json'), join(STAGE, 'api/package.json'));

  // Static SPAs — each their own dist.
  for (const app of ['admin', 'pos', 'kds', 'qr-order', 'web']) {
    cpSync(join(ROOT, `apps/${app}/dist`), join(STAGE, app), { recursive: true });
  }

  // Prisma schema + migrations + seeds.
  cpSync(join(ROOT, 'prisma/schema.prisma'), join(STAGE, 'prisma/schema.prisma'));
  cpSync(join(ROOT, 'prisma/migrations'), join(STAGE, 'prisma/migrations'), { recursive: true });
  cpSync(join(ROOT, 'prisma/seed.ts'), join(STAGE, 'prisma/seed.ts'));
  cpSync(join(ROOT, 'prisma/seeds'), join(STAGE, 'prisma/seeds'), { recursive: true });

  // Docs.
  cpSync(join(ROOT, 'docs'), join(STAGE, 'docs'), { recursive: true });

  // Build the buyer's root package.json by LIFTING the API workspace's
  // prod deps to the root. The buyer runs ONE `pnpm install` at root —
  // no workspace, no filters, no surprises. Prior version shipped a
  // SLIM package.json with no deps and used `pnpm --filter`, which
  // broke because the zip ships no pnpm-workspace.yaml — buyers got
  // `Command "prisma" not found` on the very first migrate command.
  const apiPkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8'));
  const liftedDeps = { ...apiPkg.dependencies };
  // Drop workspace: protocol entries — those don't resolve outside the
  // monorepo. The license-client comes from a git URL (already the
  // right form). The other workspace deps (@restora/types,
  // @restora/utils) are bundled INTO api/dist by nest build, so the
  // runtime doesn't need them at install time.
  for (const k of Object.keys(liftedDeps)) {
    if (typeof liftedDeps[k] === 'string' && liftedDeps[k].startsWith('workspace:')) {
      delete liftedDeps[k];
    }
  }
  writeFileSync(
    join(STAGE, 'package.json'),
    JSON.stringify(
      {
        name: global.__NAME__,
        version: global.__VERSION__,
        private: true,
        engines: { node: '22.x' },
        scripts: {
          start: 'node api/dist/main.js',
          'db:migrate': 'prisma migrate deploy --schema prisma/schema.prisma',
          'db:seed:empty': 'tsx prisma/seed.ts --variant empty',
          'db:seed:demo-light': 'tsx prisma/seed.ts --variant demo-light',
        },
        dependencies: liftedDeps,
        // Whitelist the build-script-running deps so pnpm 10 doesn't
        // skip them on install. Two categories here:
        //   1. Normal deps with postinstalls (prisma downloads the
        //      query engine; nestjs-core registers decorators; etc).
        //   2. `@restora/license-client` — git-hosted dep with a
        //      `prepare: tsc` hook. pnpm 10 blocks git-dep build
        //      scripts by default, so the install fails with
        //      "needs to execute build scripts but is not in the
        //      onlyBuiltDependencies allowlist". Adding it here
        //      unblocks the tsc run that produces dist/.
        pnpm: {
          onlyBuiltDependencies: [
            '@nestjs/core',
            '@prisma/client',
            '@prisma/engines',
            '@restora/license-client',
            'bcrypt',
            'esbuild',
            'msgpackr-extract',
            'prisma',
          ],
        },
      },
      null,
      2,
    ),
  );

  cpSync(join(ROOT, '.env.example'), join(STAGE, '.env.example'));
});

step('write deploy templates', () => {
  // Buyer-facing docker-compose.yml — Postgres + Caddy + a `node`
  // service that runs the API. All SPAs are static files served by
  // Caddy. Tiny on-purpose; buyer can extend.
  writeFileSync(
    join(STAGE, 'docker-compose.yml'),
    `# Buyer-deploy docker-compose. Brings up:
#   - api      (NestJS, port 3001 inside the network)
#   - postgres (15-alpine, internal)
#   - caddy    (TLS termination on :80/:443)
# Edit DOMAIN below + fill .env, then \`docker compose up -d --build\`.
name: restaurant-pos
services:
  api:
    image: node:22-bookworm-slim
    working_dir: /app
    volumes: [./:/app]
    env_file: [./.env]
    command: sh -c "node api/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node api/dist/main.js"
    expose: ["3001"]
    depends_on: { postgres: { condition: service_healthy } }
    restart: unless-stopped
  postgres:
    image: postgres:15-alpine
    env_file: [./.env]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      retries: 10
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine
    ports: ["80:80","443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: [api]
    restart: unless-stopped
volumes: { pgdata: {}, caddy-data: {} }
`,
  );

  writeFileSync(
    join(STAGE, 'Caddyfile'),
    `# Replace yourdomain.com with your real domain BEFORE first start.
# Caddy issues Let's Encrypt certs automatically once DNS points here.
yourdomain.com {
  encode zstd gzip
  # Static SPAs — each served from its own subpath.
  handle_path /admin* { root * /srv/admin; try_files {path} /index.html; file_server }
  handle_path /pos*   { root * /srv/pos;   try_files {path} /index.html; file_server }
  handle_path /kds*   { root * /srv/kds;   try_files {path} /index.html; file_server }
  handle_path /qr*    { root * /srv/qr-order; try_files {path} /index.html; file_server }
  # API.
  handle /api/* { reverse_proxy api:3001 }
  # Public website (root path).
  handle { root * /srv/web; try_files {path} /index.html; file_server }
}
`,
  );

  writeFileSync(
    join(STAGE, 'install.sh'),
    `#!/usr/bin/env sh
# One-shot installer. Picks up .env, brings the stack up, and prints
# the URL for the install wizard.
set -e
if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ created .env from template — edit it before re-running"
  exit 0
fi
docker compose up -d --build
echo
echo "── done ─────────────────────────────────────────────"
echo "Visit https://yourdomain.com/admin to run the install wizard."
echo "(Update Caddyfile with your real domain first.)"
`,
  );

  writeFileSync(
    join(STAGE, 'README.md'),
    `# Restaurant POS — Self-Hosted

Thanks for purchasing! This zip contains the full source + a Docker
Compose deploy template. Three install paths in
[docs/codecanyon-landing.html](docs/codecanyon-landing.html), full
runbook in [docs/INSTALL.md](docs/INSTALL.md).

## Quick start (Docker)

\`\`\`
cp .env.example .env
nano .env            # fill DATABASE_URL, JWT_SECRET, etc
docker compose up -d --build
\`\`\`

Then visit \`https://yourdomain.com/admin\` and run the install wizard.

## Layout

| Path | Purpose |
| ---- | ------- |
| \`api/\` | NestJS API build + package.json |
| \`admin/\`, \`pos/\`, \`kds/\`, \`qr-order/\`, \`web/\` | Built SPAs |
| \`prisma/\` | Schema + migrations + seed dispatcher |
| \`docs/\` | Install / domain / update guides + landing page |
| \`docker-compose.yml\`, \`Caddyfile\`, \`install.sh\` | Deploy templates |
| \`manifest.json\`, \`manifest.sig\` | Signed file inventory (used by the in-app updater) |

## License

See [LICENSE.txt](LICENSE.txt). CodeCanyon Regular or Extended terms.
`,
  );

  writeFileSync(
    join(STAGE, 'LICENSE.txt'),
    `Restaurant POS — Self-Hosted Edition
Copyright (c) 2026

Sold under the CodeCanyon (Envato Market) Regular or Extended License.
Full terms: https://codecanyon.net/licenses/standard

Summary (paraphrased; the link above is authoritative):

REGULAR LICENSE
- Use in ONE end product (one restaurant / one chain) for yourself or
  one client.
- The end product cannot itself be sold to multiple end users — i.e.
  no SaaS resale of this product as-is.
- Charge end users for access to your installed copy is allowed.
- May modify the source freely.

EXTENDED LICENSE
- Same as Regular, plus permits charging end users a fee for access
  to your end product (SaaS-style).
- Per-tenant license required if running multi-tenant.

NOT ALLOWED under either license:
- Re-distributing the source as-is or modified for free or for sale.
- Using project logo / branding for any product not based on this
  install.
`,
  );
});

let manifest;
step('compute manifest (sha256 + version + file list)', () => {
  const files = [];
  for (const f of walk(STAGE)) {
    const rel = relative(STAGE, f).split(sep).join('/');
    const buf = readFileSync(f);
    const sha = createHash('sha256').update(buf).digest('hex');
    files.push({ path: rel, sha256: sha, size: statSync(f).size });
  }
  manifest = {
    name: global.__NAME__,
    version: global.__VERSION__,
    builtAt: new Date().toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const out = JSON.stringify(manifest, null, 2);
  writeFileSync(join(STAGE, 'manifest.json'), out);
  console.log(`manifest: ${files.length} files, ${(Buffer.byteLength(out) / 1024).toFixed(1)} kB`);
});

if (!skip('sign')) {
  step('sign manifest', () => {
    if (!process.env.RELEASE_SIGNING_PRIVATE_KEY) {
      console.warn('  ⚠  RELEASE_SIGNING_PRIVATE_KEY not set — skipping signature');
      console.warn('     (the in-app updater will refuse to apply unsigned releases)');
      return;
    }
    sh(`node scripts/lib/sign-manifest.mjs "${join(STAGE, 'manifest.json')}" "${join(STAGE, 'manifest.sig')}"`);
  });
}

if (!skip('scan')) {
  step('secret-scan staged tree', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts/lib/secret-scan.mjs'), STAGE], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('secret scanner found brand/secret leaks in the staged tree — aborting');
      process.exit(r.status ?? 1);
    }
  });
}

step('zip', () => {
  // Try the platform's available zipper in priority order. The point
  // is to work on a fresh CI runner AND a Windows dev box without
  // forcing either to install a new tool.
  //   1. `zip`      — Linux/macOS standard
  //   2. `7z`       — Common on Windows (7-Zip)
  //   3. PowerShell Compress-Archive — built into Windows 10+
  const releaseDir = join(ROOT, 'release');
  const tryZip = () => sh(`zip -rq "${ZIP}" "${RELEASE_NAME}/"`, { cwd: releaseDir });
  const try7z = () => sh(`7z a -tzip -bd "${ZIP}" "${RELEASE_NAME}/" -mx5`, { cwd: releaseDir });
  const tryPwsh = () => sh(`powershell -NoProfile -Command "Compress-Archive -Path '${RELEASE_NAME}' -DestinationPath '${ZIP.replace(/\\/g, '/')}' -Force"`, { cwd: releaseDir });

  const attempts = [['zip', tryZip], ['7z', try7z], ['Compress-Archive', tryPwsh]];
  let ok = false;
  for (const [name, fn] of attempts) {
    try {
      fn();
      console.log(`(packed via ${name})`);
      ok = true;
      break;
    } catch {
      // keep trying
    }
  }
  if (!ok) {
    console.error('No zip tool available. Install one of: `zip` (apt install zip), `7z` (7-Zip on PATH), or run on Windows 10+ (PowerShell Compress-Archive is built in).');
    process.exit(1);
  }
  const sz = statSync(ZIP).size;
  console.log(`\n✔ ${ZIP}  (${(sz / (1024 * 1024)).toFixed(1)} MB)`);
});

// ── helpers ─────────────────────────────────────────────────────────

function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs);
    else if (ent.isFile()) yield abs;
  }
}
