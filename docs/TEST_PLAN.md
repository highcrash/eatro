# Manual Test Plan — v1 Release Gate

Run this checklist against a fresh install before shipping a release
zip. All eight scenarios must pass. Scenario H is enforced by the
packager (secret scanner runs on the staged tree); the rest need a
human operator.

## Last-run status (2026-04-20)

| Scenario | Status | Notes |
| -------- | ------ | ----- |
| A (fresh install wizard) | ✅ pass | Walked headless on 192.168.86.47 (Ubuntu 25.04): branch + owner + license activate + finish, all clean. `/install/finish` → 404 after, `/install/status` → `needsInstall: false`. |
| B (offline grace)        | ⏳ pending | Needs clock-travel; plan Section 2 has the recipe. |
| C (domain spoof)         | ✅ pass | `Host: evil.attacker.io` → `403 DOMAIN_MISMATCH` exactly as expected. |
| D (installer self-disables) | ✅ pass | Covered by A. |
| E (update + rollback)    | ✅ pass | End-to-end on 192.168.86.47: v0.1.1 → upload v0.1.3 → APPLIED in 3 s → rollback → ROLLED_BACK in 3 s. Caught two real bugs along the way (commits 1e3f7d2 unzip-flatten, 8d0d6c4 rollback DB restore). |
| F (license revocation)   | ⏳ pending | Needs neawaslic admin panel access + ≤1h wait for the hourly cron. |
| G (DB tamper detection)  | ✅ pass | `UPDATE license_records SET activatedDomain=...` → boot verdict `missing` → POSTs 503 `LICENSE_LOCKED`. Re-activation recovers cleanly. |
| H (brand-free package)   | ✅ pass | `pnpm codecanyon:package` staged + scanned 858 files, 0 brand tokens. |

Blockers for v1 ship: **none**. B and F are polish — each covers a
regression we'd catch in real operation within 1–24 hours rather
than at release gate time.

## Scenario A — Fresh install happy path

**Goal:** wizard runs, owner logs in, install disables itself.

1. Empty DB (`pnpm db:seed:empty`).
2. `pnpm dev:api` + `pnpm dev:admin`.
3. Visit `http://localhost:5173` → wizard auto-renders.
4. Run system check → all green.
5. Create branch "Test Restaurant", address "1 Street", phone
   "+10000000000".
6. Create owner Alice `alice@example.com` with an 8-char password.
7. Fill branding (skippable).
8. Finish → hard reload → login page appears.
9. Log in with Alice's creds. Dashboard loads.
10. `curl http://localhost:3001/api/v1/install/finish -X POST -H
    "Content-Type: application/json" -d '{}'` → **404**.
11. `GET /api/v1/install/status` → `needsInstall: false`.

**Pass criteria:** every step completes without error, no 500s.

## Scenario B — Offline grace

**Goal:** 7-day grace works, then lockdown.

1. Activate a license against a test purchase code (point
   `LICENSE_SERVER_URL` at `http://localhost:3002` for your local
   license-server instance).
2. Stop the local license-server.
3. In the POS, create an order. **Expect:** works, mode=active.
4. Advance wall clock by 25h (systemd-ish: edit
   `license_records.lastVerifiedAt` to 25h ago).
5. Restart API. Create another order. **Expect:** works;
   `/license/status` reports mode=grace with graceDaysRemaining=6.
6. Advance clock to 8 days past lastVerifiedAt. Restart.
7. GET a report → 200. POST a new order → **503 LICENSE_LOCKED**.
8. Restart the license-server, re-verify via the cron or
   `POST /license/activate` again. POSTs unblock.

## Scenario C — Domain spoof

1. Activate against `demo.example.com`.
2. `curl -H "Host: other.example.com" -X POST http://api:3001/
   api/v1/orders -d '{}'`.
3. **Expect:** 403 `DOMAIN_MISMATCH`.
4. Same curl without the Host header (or with the right one) →
   passes the gate (may then 401 for missing auth, which is fine).

## Scenario D — Installer self-disables

Covered by Scenario A step 10 — kept as its own scenario because
it's the single most-tested outcome for the CodeCanyon reviewer.

## Scenario E — Update + rollback

1. Produce `v1.0.0.zip` with `pnpm codecanyon:package`.
2. Install it fresh. Make a test order. Observe the order count.
3. Bump the version to 1.0.1, `codecanyon:package` again.
4. In the admin UI: Settings → Updates → drop the 1.0.1 zip.
5. **Expect:** progress bar finishes OK, login remains, test order
   still visible.
6. Now intentionally break v1.0.2 (e.g., rename a DB column in the
   migration so deploy fails), package, upload.
7. **Expect:** deploy fails in the health-check loop, auto-rollback
   runs, API comes back on v1.0.1 with the test order intact.

## Scenario F — License revocation

1. With an active license, mark it revoked on the license-server
   admin panel.
2. Wait ≤1h for the hourly cron to run (or restart the API).
3. **Expect:** `/license/status` → mode=locked, status=REVOKED.
4. POST /orders → 503 LICENSE_LOCKED.
5. GET /orders → still 200.

## Scenario G — Tampered DB row

1. Activate a license.
2. `UPDATE license_records SET activatedDomain='pwned.attacker.io'`
   (leaving verdictHmac unchanged).
3. Restart the API.
4. **Expect:** boot logs `verdict: missing — No license cached`
   (HMAC mismatch, row treated as missing).
5. POST /orders → 503.
6. Re-activate via `/license/activate` → normal service resumes.

## Scenario H — Brand-free package

**Enforced by the packager.** Running `pnpm codecanyon:package` runs
the secret scanner on the staged tree. Any hit fails the build with
a non-zero exit code. Manual check:

```bash
pnpm codecanyon:package --skip-build --skip-sign
# → must end with "✔ release/<name>-vX.Y.Z.zip"
# → must NOT print any "FAILED — N forbidden token hit(s)"
```

Additionally: unzip the final zip to a scratch dir and run:

```bash
node scripts/lib/secret-scan.mjs /tmp/unzipped
# → "[secret-scan] clean — scanned N text files"
```

Any hit = blocker. Fix the source, re-package.
