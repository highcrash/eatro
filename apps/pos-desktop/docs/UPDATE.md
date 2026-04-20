# Updates — Restaurant POS Desktop

The desktop edition does NOT auto-update. Each release is a fresh
installer you re-download and run; Windows handles the upgrade in
place and your data + license + paired device token are preserved.

## How to update

1. Sign in to your seller account / open the order email.
2. Download the new `YourRestaurantPOS-Setup-X.Y.Z.exe`.
3. Quit the running terminal app (right-click tray icon → Quit, or
   close the window).
4. Double-click the new installer.
5. NSIS installer detects the existing install, swaps `Program Files`
   contents in place, and restarts.
6. Launch from Start menu or shortcut. License + pairing carry across.

Total downtime: under a minute.

## What survives an update

| Survives | Reset / lost |
|---|---|
| License activation | — |
| Paired device token | — |
| Cashier PIN hashes | — |
| Local outbox SQLite (offline orders) | — |
| Printer slot config | — |
| Window size / fullscreen state | — |
| Logs older than 30 days | Auto-pruned |

Anything you customised inside `C:\Program Files\Your Restaurant POS`
itself (icon overrides, hand-edited JS, etc.) gets overwritten.
Don't make changes there — the install location is meant to be
disposable.

## Why no auto-update?

The codecanyon edition ships one signed `.exe` per buyer per release.
Pointing every terminal at a public update feed would mean either
hosting that feed (extra infra cost, abuse vector) or letting buyers
hit the seller's GitHub directly (exposes the seller's repo).
Manual re-download keeps the trust boundary tight and matches how
buyers expect a CodeCanyon-style sale to work.

If you want auto-updates across multiple tills in one shop, set up
a tiny share on your network, drop the new `.exe` there, and have
each cashier double-click it whenever a release ships. The whole
exchange is one file, ~100 MB.

## Release cadence

The seller posts a CHANGELOG with each tagged release on the
account portal. Patch releases (X.Y.**Z**) go out for bug fixes;
minor releases (X.**Y**.0) for new features.

## Downgrade

Re-running an older installer over a newer one works for the file
swap, but the local SQLite outbox schema may have moved on. If a
downgrade leaves the app booting with errors, wipe `%APPDATA%\Your
Restaurant POS\outbox.sqlite` and restart — the outbox rebuilds
from the next sync. License + device pairing are unaffected.

## What's NOT a desktop update

The **server-side** update is a separate flow on a different schedule.
The web admin's `Updates` page handles that one (drop the server
release zip, click Apply, the API restarts in ~10s). See the web
edition's `docs/UPDATE.md`. Keep both versions in step — a desktop
build and a server build with the same minor version (X.Y.*) are
guaranteed to interop; mixing major versions is at your own risk.
