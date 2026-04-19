/**
 * License gate constants — BAKED AT BUILD TIME, not env-read.
 *
 * Why not .env: the .env file ships with the zip and buyers can
 * edit it. If the license server URL + public key were env-read,
 * a buyer could stand up a mock server, swap both keys + URL in
 * .env, and the gate would happily accept the mock's fake proofs
 * because it'd verify them against the (attacker-supplied) pubkey.
 *
 * By hardcoding these into the TypeScript source, a cracker has
 * to:
 *   1. Find the minified constants in api/dist/main.js (non-trivial
 *      — they're embedded inside the bundled module, not a
 *      separate file).
 *   2. Hot-patch the JS without breaking the bundle.
 *   3. Convince a hosted license server to co-sign their fake
 *      proofs (still impossible; they also need to replace the
 *      bundled public key with one whose matching private key they
 *      control).
 *
 * Not a perfect defense — no client-side DRM is — but it raises
 * the bar from "edit three lines in .env" to "de-obfuscate the
 * bundled JS and replace three embedded strings without breaking
 * the surrounding code". Per the plan, we accept ~5% crack rate
 * and focus on making the happy path painless for legit buyers
 * rather than chasing perfect protection.
 *
 * The packager (scripts/package-codecanyon.mjs) overwrites this
 * file before running `turbo run build` so the production zip
 * carries the live production values. Edit this file for local
 * dev (point at your own license-server instance); the packager
 * will replace your edits on the next release build.
 */
export const LICENSE_CONSTANTS = {
  // Production license server — live at api.neawaslic.top.
  serverUrl: 'https://api.neawaslic.top/api/v1',

  // Product SKU the buyer's install activates against. Changing
  // this just rejects every purchase code — not a bypass vector.
  productSku: 'restora-pos-cc',

  // Current ed25519 public key (base64url, raw 32 bytes). Rotated
  // server-side on a 30-day retire window; the local cache fetches
  // /products/:sku/public-key when it sees a signed proof with an
  // unknown kid, so rotations don't break installed buyers.
  publicKey: 'V3ZYtvqsnCVhGiE7LJog9vPE_VkyiLBz96N3inDO1j4',
  publicKeyKid: 'gAz2iS5Y',
} as const;
