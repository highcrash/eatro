// Local smoke-test helper. Creates one ExternalApiKey bound to the OWNER's
// branch with full read scopes and prints the plaintext key. The admin UI
// at /integrations is the supported way to mint keys — this script exists
// so a fresh dev install can curl-smoke the external API before the UI is
// available. Revoke with:
//   DELETE FROM external_api_keys WHERE name='smoke-test'
// or via the Admin UI.
//
// Run from repo root:  node scripts/create-test-api-key.mjs

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// bcrypt isn't a root-level dep; resolve it from apps/api/node_modules
// so this script works on any OS.
const bcrypt = require(join(here, '..', 'apps', 'api', 'node_modules', 'bcrypt'));

const prisma = new PrismaClient();

const owner = await prisma.staff.findFirst({ where: { role: 'OWNER' } });
if (!owner) {
  console.error('No OWNER found');
  process.exit(1);
}

const prefix = randomBytes(4).toString('hex');
const secret = randomBytes(32).toString('base64url');
const keyHash = await bcrypt.hash(secret, 12);

const row = await prisma.externalApiKey.create({
  data: {
    branchId: owner.branchId,
    createdById: owner.id,
    name: 'smoke-test',
    prefix,
    keyHash,
    scopes: [
      'business:read',
      'reports:read',
      'finance:read',
      'inventory:read',
      'menu:read',
      'customers:read',
      'loyalty:read',
      'marketing:read',
      'reviews:read',
    ],
  },
});

console.log(`Created key id=${row.id} branchId=${row.branchId} scopes=${row.scopes.join(',')}`);
console.log(`PLAINTEXT_KEY=rk_${prefix}_${secret}`);

await prisma.$disconnect();
