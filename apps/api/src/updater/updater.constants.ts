/**
 * Updater constants. Baked in at build time via the same pattern as
 * license.constants.ts — anything security-sensitive (the signing
 * public key especially) lives here and gets compiled into dist
 * rather than read from env.
 *
 * The packager (scripts/package-codecanyon.mjs) signs manifest.json
 * with a private key kept off-repo; the matching public key is
 * pasted here before each release build so installed copies reject
 * unsigned zips or zips signed by an attacker's key.
 *
 * Rotating the release signing key rotates the public key here too —
 * both halves change in lockstep. Until a buyer gets an update
 * carrying the new pubkey, they can't accept zips signed with it.
 */
export const UPDATER_CONSTANTS = {
  // ed25519 public key (base64url, raw 32 bytes).
  // IMPORTANT: this must match the private key the packager uses to
  // sign manifest.json. When the seller generates a release signing
  // key for the first time, paste the public half here, commit, and
  // rebuild — every zip produced after that will verify against it.
  //
  // Empty string means "reject every zip" — safer default than "",
  // which would fail open. The seller sets this on first release.
  signingPublicKey: 'wf_xjn4i6sXSklKVNJ5kywj_-AyVYsmxSNV1ta70VhE',
  signingPublicKeyKid: 'v1',

  // Paths relative to the install root where we stage + archive
  // updates. Kept off the public static-file roots (admin/, pos/,
  // etc) so nginx can't serve them.
  stagingDir: 'updates/staging',
  archiveDir: 'updates/archive',
  // Keep the one most-recent pre-apply tree so a manual rollback
  // has something to swap back to. Older ones get pruned on the
  // next successful apply.
  previousDir: 'updates/prev',
} as const;
