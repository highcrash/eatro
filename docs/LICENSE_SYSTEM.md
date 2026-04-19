# License System

## How it works

This product ships with a license gate that verifies your purchase
code against an independent license server. Activation binds the
license to one domain (or a `*.example.com` wildcard for franchise
licenses). The verification runs once at activation and once per day
thereafter to keep the install in "active" mode.

## Modes

| Mode | When | What works |
| ---- | ---- | ---------- |
| `active`  | Verified within the last 24h | Everything |
| `grace`   | Last verify > 24h, < 7 days  | Everything; a banner warns the operator |
| `locked`  | Last verify > 7 days OR license revoked | Reads only — POSTs return 503 `LICENSE_LOCKED` |
| `missing` | No license cached / activation never ran | Visit Settings → License to activate |

## Offline tolerance

The 7-day grace period is measured from the LAST SUCCESSFUL VERIFY
(stored in the local DB), not from the proof's `issuedAt`. A clock
rewind on the server can't extend the window — the install measures
elapsed wall-clock time from its own last-success record.

If the license server is unreachable but you're within grace, the
gate still answers `active` / `grace`. Reads always work.

## What gets sent

Activation and verification calls send:

- Your purchase code
- The domain the install is running on
- An opaque per-machine fingerprint (HMAC of OS-level machine-id,
  not reversible)

Nothing about your menu, customers, orders, or staff leaves the
server. The full source for the verification client is in
`api/dist/license/` (built from `apps/api/src/license/` in the
source tree).

## Moving installs

Each license can only be active on one install at a time. To move:

1. Settings → License → Deactivate. Releases the seat.
2. Re-activate from the new install with the same purchase code.

If your old install is gone (hardware failure, etc.) without
deactivating, contact support — we can release the seat
administratively after verifying ownership via the CodeCanyon
purchase code.

## Revocation

If you suspect your purchase code was leaked, contact support to
have it revoked + reissued. Revocation propagates to the install
within ~1 hour (the next hourly verify picks it up).
