# FAQ

### Do I need an internet connection?

The license verification needs internet at activation and once per
day. After that you have a 7-day grace period — everything keeps
working offline. Day 8 onwards, mutations are blocked but reads
(reports, history) still work.

### What's the minimum hosting?

A $6/month VPS with 2 GB RAM, 20 GB disk, Node 22, Postgres 15.
Most Linode/DO/Vultr nano tiers are enough for a small restaurant.

### Can I run this on shared cPanel hosting?

Yes — see [INSTALL.md](INSTALL.md) section 3. Your cPanel host needs
the **Node.js App Manager** with Node 22 support, plus a Postgres
database from cPanel's database tools.

### How do customisations survive updates?

Database content (menu, customers, orders, settings) survives
everything. Source code modifications get overwritten by the buyer-zip
update path. If you're modifying source, fork the repo and merge
upstream releases manually rather than using the in-app updater.

### Does the license check phone home with my data?

No — only purchase code, domain, and an opaque per-machine
fingerprint. Source for the verification client is in
`api/dist/license/` — every line is auditable.

### What happens if your license server goes down?

Your install keeps running on the locally-cached signed proof for up
to 7 days. The proof is signed with a key bundled at build time, so
even if our server is unreachable you keep operating normally.

### Can I move to a new domain?

Yes. Settings → License → Deactivate (releases the seat), then
re-activate on the new domain.

### Can I run multiple branches?

Yes — multi-branch is built in. One install supports any number of
physical locations under the same owner. Each branch has its own
menu, staff, payment methods, and reports.

### Do I get the source code?

Yes — full TypeScript source for API, admin, POS, KDS, QR-order, and
public website. Not minified, not obfuscated.

### Is the POS Desktop included?

No — that's a separate purchase. The web POS works fine in any
browser, including a wall-mounted touch screen running Chrome in
kiosk mode.

### How do I get support?

Use the CodeCanyon item's comment thread for general questions, or
the support link in the item description for tickets.

### Can I run multi-tenant for several restaurants?

Each install is single-tenant by design. To run it as a SaaS for
multiple restaurants you need an Extended license per tenant.
Most buyers use multi-branch instead — one install, many locations,
same owner.

### Can I customise the install wizard?

Yes — `apps/admin/src/install/InstallWizard.tsx` is a regular React
component. Modify text, add steps, change validation. Re-run
`pnpm codecanyon:package` if you're producing your own zips.

### "DOMAIN_MISMATCH" error after deploying

Your `Host` header doesn't match the domain you activated against.
Common causes: deploying to an IP without a hostname, or your reverse
proxy not forwarding the original Host header. Check `nginx
proxy_set_header Host $host;` is set.

### "LICENSE_LOCKED" on every POST after restart

Your install hasn't been activated, OR the cached license row got
tampered with (verdictHmac mismatch). Visit Settings → License and
re-enter your purchase code; activation is idempotent.
