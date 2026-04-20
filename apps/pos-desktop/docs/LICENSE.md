# License — Restaurant POS Desktop

## How licensing works

Each desktop install is bound to **one Windows machine** via a per-PC
fingerprint derived from the Windows MachineGuid + hostname. One
purchase code = one terminal. To move to a different PC, deactivate
on the old box first.

The license server is reached over HTTPS once at activation, then
once an hour to refresh. Your purchase code, owner email, and any
restaurant data NEVER leave your network — only an opaque license
ID + machine fingerprint cross the wire.

## Online vs offline

- **Online (network reachable):** verifies hourly. Status flips to
  `revoked` / `expired` within ~1 hour of any server-side change.
- **Offline (router down, ISP outage, on-the-road):** the cached
  proof is honoured for **7 days** since the last successful verify.
  After 7 days the terminal locks itself until the next online check
  re-validates.

7 days is intentional — you can run a full day's service through
most outages without intervention. If your shop genuinely goes
offline for longer than a week, plug the till into a phone hotspot
for 30 seconds to refresh.

## Activation slots

Default: **1 activation per code**. The seller can configure higher
(2-seat, 5-seat, etc.) at sale time. Once a slot is used:

- Activating again on the SAME machine returns the same slot
  (idempotent, free).
- Activating on a DIFFERENT machine consumes a second slot, or
  fails with `CODE_EXHAUSTED` if no more are available.

To free a slot before the seller refreshes it, click **Deactivate**
in the License settings panel on the terminal you want to retire.

## Recovery scenarios

### "I reinstalled Windows and lost my activation"

Wiping Windows regenerates the MachineGuid → the new install can't
pick up the old slot automatically. Two options:

1. **From the new install:** try activating with the same code.
   If you have spare seats, this just works.
2. **No spare seats:** ask the seller to release the old slot from
   the license-admin panel. Then activate normally on the new box.

### "Hardware died, can't deactivate from the old terminal"

Same as above — contact the seller to release the slot manually.
Hardware-loss recovery is a support flow, not an automated one,
because we can't tell "actually moved to new PC" from "trying to
dual-license" without owner intervention.

### "License says REVOKED but I never deactivated"

The seller revoked the code on their side (refund issued, dispute,
charge-back, etc.). The status is sticky — re-activating the same
code returns `REVOKED` indefinitely. You'll need a new code.

### "Code says EXPIRED"

You bought a subscription and the period ended. Renew via the
seller's checkout — the new charge issues a fresh code.

### "Activation fails with NETWORK_ERROR"

License server is unreachable from this PC. Check:
- Internet connectivity (ping 8.8.8.8).
- The terminal's DNS can resolve `api.neawaslic.top`.
- Corporate firewall isn't blocking outbound HTTPS to that host.

If you're behind a strict firewall, allow outbound 443 to
`api.neawaslic.top` only — that's the only host the desktop
contacts for licensing.

## Privacy

The license server stores:

- Your **purchase code** (hashed, not plaintext).
- An **opaque license ID** generated server-side.
- Your **machine fingerprint** (an irreversible hash of MachineGuid
  + hostname; no original values can be recovered).
- The **last-seen IP + timestamp** for abuse detection.

It does NOT store: restaurant name, menu data, order data, customer
data, staff names, prices, sales numbers, or anything else from
your POS. Those live exclusively in your own database on your own
server.

## Terms

You're licensed to run the software on the number of seats you
purchased, modify the source for your own use, and self-host
indefinitely. You cannot resell or redistribute the source. Full
license text is in the `LICENSE.txt` shipped alongside this file.
