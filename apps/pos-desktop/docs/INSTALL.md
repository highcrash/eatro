# Install — Restaurant POS Desktop (Windows)

Single-machine cashier terminal that runs on Windows 10 or 11.
The web admin / website / KDS / QR ordering live on your separate
**API server** (Linux VPS, see the web edition's `docs/INSTALL.md`).
This installer is the cashier-side terminal you set up next to each
till.

## What you'll need

- **Windows 10 or 11** (64-bit). Server / Pro / Home all work.
- **Local network access to your API server** — usually a Linux box
  on the same router, e.g. `http://192.168.1.50/api/`.
- Your **purchase code for the desktop product** (separate from the
  web-edition code if you bought both).
- Your **owner email + password** from the web admin panel — used
  once at first launch to pair the terminal to a branch.

## Install

1. Download `YourRestaurantPOS-Setup-X.Y.Z.exe` from your seller
   account / order email.
2. Double-click. Windows SmartScreen may warn — click **More info →
   Run anyway** (the installer is unsigned in this release; future
   builds may be code-signed).
3. Choose the install location and which shortcuts you want, then
   **Install**. Takes ~30 seconds and lands at
   `C:\Program Files\Your Restaurant POS\` by default.
4. Launch from the Start menu or the desktop shortcut.

## First launch — three steps

### Step 1 of 2 — License

Paste the purchase code from your order receipt. The format is
`XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`. Click **Activate**.

This binds the install to the Windows machine ID. One terminal per
purchase code. You can deactivate later (under license trouble) to
release the slot before re-activating on a different PC.

If activation fails:
- **`CODE_NOT_FOUND`** — the code was mistyped. The grouping is
  decorative; only letters + digits are checked.
- **`CODE_EXHAUSTED`** — the code is already activated on another
  machine and is single-seat. Deactivate the other install first or
  contact the seller for an additional seat.
- **`REVOKED`** — the seller marked this code as no longer valid.
  Buy a new one.
- **No internet** — activation requires reaching the license server
  ONCE. After that, the terminal works offline for up to 7 days
  before re-verifying.

### Step 2 of 2 — Pair to a branch

Enter:

| Field | What goes here |
|---|---|
| **Server URL** | `http://YOUR-SERVER-IP/api/` (the trailing `/api/` matters). For dev / LAN, plain `http://`. For production, use `https://` and a real domain. |
| **Owner email** | The email you used during the web-edition install wizard. |
| **Owner password** | The matching password. Used once for pairing — never stored locally. |
| **Branch ID** | The branch this terminal serves. Find it in the web admin → Branches → click the row → URL contains the ID. |
| **Terminal name** | Free text (e.g. `Front`, `Bar`, `Kitchen-Pickup`). Shows up in the web admin's Terminals page. |

Click **Pair Terminal**. A device token is generated server-side and
stored locally (DPAPI-encrypted). The owner password is never
written to disk.

### Step 3 — Cashier PIN sign-in

After pairing you land on the **Lock Screen**. Tap a cashier tile,
enter their 4-digit PIN. If a cashier has no PIN yet, they're
prompted to set one (the owner password is required to authorise
the first set).

That's it. From here on, every launch goes straight from Lock Screen
to POS — no re-pairing, no re-activation. The cashier just enters
their PIN.

## Where data lives

| What | Where |
|---|---|
| Paired device token | `%APPDATA%\Your Restaurant POS\config.enc` (DPAPI) |
| License proof + cache | `%APPDATA%\Your Restaurant POS\license.enc` (DPAPI) |
| Offline order outbox | `%APPDATA%\Your Restaurant POS\outbox.sqlite` |
| Logs | `%APPDATA%\Your Restaurant POS\logs\` |

DPAPI scope is per-Windows-user — copying the files to another user
account or another machine yields garbage on decrypt. To migrate to
new hardware: deactivate from the old box (settings menu), reinstall
on the new box, re-activate.

## Network printers

After signing in, open the side panel → **Printer settings** to
configure up to three slots:

- **Kitchen** — 80 mm thermal, ESC/POS over TCP.
- **Bill / receipt** — 80 mm thermal.
- **Reports** — A4 office printer (uses the Windows print spooler).

For thermal printers, pick **Network** mode and enter the printer's
IP and port (usually 9100).

A test print button per slot lets you verify before going live.

## Updates

Each release ships as a fresh installer. Re-download the latest
`.exe` from your seller account when a new version comes out and
double-click — Windows will overwrite the previous install while
preserving your config + license + outbox automatically (data lives
under `%APPDATA%`, not under `Program Files`).

The desktop edition does NOT auto-update from a public feed. The
seller pushes new builds via your account email instead. This is
deliberate — buyers shouldn't have to expose any internet endpoint
beyond the license server.

## Uninstall

Settings → Apps → Your Restaurant POS → Uninstall. Your data under
`%APPDATA%` is preserved by default — useful for re-installing
after a Windows reinstall. To wipe everything, also delete that
folder manually after uninstalling.

## Troubleshooting

### "Update failed 404 …github.com/…/your-repo"

Old build (≤ 0.9.0). Re-download the latest installer — auto-update
is disabled in 0.9.1+ for the codecanyon edition.

### "device:register" → "No active license"

The **API server** isn't licensed (separate from the desktop
license). Activate the server's web-edition purchase code first —
see the web edition's `docs/INSTALL.md` for the wizard. The desktop
won't pair into an unlicensed server.

### "DPAPI not available"

Running on a non-Windows host (e.g. Wine, Linux dev). The app falls
back to plaintext storage — fine for development, never deploy a
real terminal that way.

### Black screen on launch

Hold F11 to toggle out of fullscreen, then F12 → check console for
the underlying renderer error. Most common cause: the API server's
URL changed but the device's cached pairing still points at the
old one. Deactivate + re-pair from the side panel.

### Can't reach the API from the till

- Verify the cashier laptop can reach the server: `ping 192.168.1.50`
  in cmd.
- Verify the API responds: open `http://192.168.1.50/api/v1/health`
  in a browser — should return `{"status":"ok",…}`.
- Firewall: server-side, port 80/443 must be open from the LAN.

### Terminal shows "REVOKED"

The owner unpaired this terminal from the web admin → Terminals
page. The cashier sees the lock-out screen. To put it back in
service: from the lock-out screen, click **Unpair this terminal**,
enter the owner password, then run first-run setup again.
