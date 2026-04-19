# Changelog

All user-visible changes to the web edition. Dates in YYYY-MM-DD.

## [1.0.0] — Initial release (2026-04)

### POS + operations
- Touch-first cashier UI with dine-in / takeaway / delivery modes
- Kitchen Display (KDS) with per-station ticket routing, ack/recall
- QR self-order PWA with optional on-premise Wi-Fi gate
- Multi-branch with shared owner + per-branch data
- Public website with built-in CMS (menu, reservations, contact)

### Inventory + F&B
- Ingredients, suppliers, purchase orders, returns
- Recipes auto-deduct ingredients on sale
- Pre-ready foods with production orders + approval workflow
- Waste log
- Low-stock shopping list

### Accounting + staff
- Multi-account ledger with payment-method linkage
- Daily / sales / void reports
- Expense tracking
- Staff roles, attendance, leave, monthly payroll
- Cashier permissions

### Platform
- Install wizard (5-step) on empty DBs, self-disables after finish
- Settings → License tab for activation / deactivation
- Settings → Updates tab for admin-UI zip re-upload with auto-backup
- Branch-scoped theming + branding
- Idempotency-keyed mutation endpoints for reliable retries
- Database backup + restore (owner-only)

### Licensing
- One license per domain (or `*.example.com` wildcard)
- 7-day offline grace period after last successful verify
- ed25519-signed proofs; DB-tampering detected via HMAC on the cache
- Reads always work even when locked; POSTs require active/grace
