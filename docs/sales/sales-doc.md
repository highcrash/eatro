# Restora POS — The Restaurant Operating System

**The restaurant POS built for how Bangladesh actually runs.**

Mushak-compliant out of the box. Works when the internet doesn't. One
licence, every module included, your server, your data.

> 12-minute read · For owners and managers of dine-in restaurants,
> cafés, cloud kitchens, and small chains in Bangladesh and South Asia.

---

## Contents

1. [Why we built this](#1-why-we-built-this)
2. [What's different about Restora POS — the seven signals](#2-whats-different-about-restora-pos--the-seven-signals)
3. [The full stack — what's in the box](#3-the-full-stack--whats-in-the-box)
4. [Feature deep-dive — ten modules](#4-feature-deep-dive--ten-modules)
5. [How we compare](#5-how-we-compare)
6. [The cost story](#6-the-cost-story)
7. [Who Restora POS is for (and who it isn't)](#7-who-restora-pos-is-for-and-who-it-isnt)
8. [Day 1 → Month 1 — what go-live looks like](#8-day-1--month-1--what-go-live-looks-like)
9. [Trust & security](#9-trust--security)
10. [Get started](#10-get-started)

---

## 1. Why we built this

If you run a restaurant in Bangladesh, you live with a stack of
problems no foreign POS company has bothered to fix:

**The NBR Mushak audit.** Every paid bill needs a Mushak-6.3 invoice
with a serial number that's atomic, sequential, never reused, never
skipped. Every refund needs a Mushak-6.8 credit note tied to the
original. Today most restaurants do this with paper books and Excel
mirrors — and pay the fines when the audit finds a gap.

**The internet drops in the middle of dinner service.** Your cloud-only
POS says "connecting…" and your cashier shrugs at the customer holding
a 4,500-taka bill. You've lost the order, the customer, and the table.

**SaaS fees in dollars, every month, forever.** A typical mid-market
POS quotes USD 79–299 per month per location. Three terminals across
two branches, twelve months a year — five years and you've paid more
in subscription than the whole software is worth. And you still own
nothing.

**Five different tools, five different logins.** POS for the front,
KDS for the kitchen, Tally / Excel for the accounts, WhatsApp for the
suppliers, Facebook for the marketing. Every one of them is a separate
purchase, a separate training session, a separate place where data
goes to die.

**Generic POS doesn't speak your kitchen.** Variants. Pre-ready
batches. Recipe roll-ups across parent and child ingredients. Stock
reconciliation when the storeroom and the software disagree. The
Bangladesh restaurant kitchen has more depth than a Western quick-serve
chain — your software needs to match it.

**Restora POS is built for that exact stack of problems.** It's not a
generic POS we localised — it's a POS designed from day one around
NBR-Mushak compliance, intermittent internet, WhatsApp-as-supply-chain,
and the deep ingredient hierarchy a real Bangladesh kitchen needs.

---

## 2. What's different about Restora POS — the seven signals

Seven things that would, individually, be reason to choose Restora
POS. Together, they're a different kind of product.

### 2.1 Bangladesh-first compliance

Mushak 6.3 invoices are issued the moment an order is paid. Mushak
6.8 credit / debit notes fire automatically on refund. Sequence
generation is atomic per (branch, fiscal year, document kind) — a
single SQL `INSERT … ON CONFLICT DO UPDATE … RETURNING` so concurrent
terminals can't reuse or skip a serial even on a Friday-night rush.
Every issued invoice freezes a JSON snapshot at the moment of issue,
so a reprint three months later is still legally identical even if
your menu prices or VAT rate changed in the meantime.

The Mushak Register report is built into the admin panel. When the NBR
inspector arrives, you hand them the printout. No paper book, no Excel
mirror, no fines.

### 2.2 Offline-first desktop terminal

The Windows cashier app is an Electron build with a SQLite outbox
underneath every mutation. When the internet drops mid-rush:

- The cashier types the order. The UI gets a synthetic order id back
  in milliseconds and treats it as real.
- The kitchen ticket prints to the thermal printer. The cash drawer
  kicks. The receipt prints. None of this needs the server.
- The mutation goes into the outbox with an Idempotency-Key.
- When connectivity returns, the outbox drains in FIFO order. Synthetic
  ids get rebound to real server ids. Already-paid orders get the
  exact same response back from the server's idempotency cache —
  no double-charge, no double-Mushak.

The cashier doesn't see "syncing…", the customer doesn't see "card
declined", and the bill prints regardless of WiFi.

### 2.3 Recipe-depth inventory

Most POS in this price bracket track ingredients as a flat list. Restora
POS tracks them as a hierarchy:

- **Parent ingredients** with **variants** (e.g. "Pulao Rice Pack" with
  variants 1kg / 5kg / 25kg). Stock decrements happen on the variant;
  the parent's `currentStock` is the rolled-up sum and refreshes
  automatically.
- **Recipes** with cost roll-up. Every menu item costs are computed
  from the actual ingredient costs at the time of receipt — not from
  a number an admin typed in once and forgot.
- **Pre-ready batches**. Production is a first-class concept: cook
  20 portions of biryani, log the production, FIFO it out as orders
  come in, log waste if the batch expires unsold.
- **Stock movements with cost stamping**. Every WASTE / SALE / PURCHASE
  / ADJUSTMENT row carries the per-unit cost at the moment it was
  written, so historical reports stay accurate even after costs shift.
- **Stock Reconciliation**. Print the count sheet, walk the storeroom,
  type the actuals back in, the system logs each variance as either
  WASTE (with a reason — spoilage, prep error, contamination) or
  ADJUSTMENT, and updates the stock to match what's on the shelf.

### 2.4 WhatsApp-native procurement

In Bangladesh, suppliers don't read email. They read WhatsApp. Restora
POS is the only POS in this comparison that knows that:

- Create a Purchase Order in the admin panel.
- The PDF is generated server-side and **sent directly to the
  supplier's WhatsApp** via the Meta Business API.
- The supplier replies "received" in WhatsApp; you mark the PO
  received, the stock auto-increments and the per-unit cost is stamped
  onto every future stock movement.
- The supplier ledger is also accessible by WhatsApp: a supplier can
  ask you for a statement and you can WhatsApp them the latest one in
  one click.

### 2.5 Auto-Facebook posts on every discount

Bangladesh restaurants live on Facebook. Every time you create a
discount in the admin panel, Restora POS can auto-generate a Facebook
post — discount name, value, menu item image — and queue it to your
configured page. A per-minute background worker handles delivery and
retries. Default off per branch; flip it on once and discounts publish
themselves.

### 2.6 Self-hosted, you-own-your-data

Restora POS runs on your own server. A single VPS handles a
multi-branch chain comfortably. The database is yours. The backups are
yours. The data never leaves your infrastructure unless you decide to
move it.

The admin Install Wizard walks you through it on first run. Daily
automated backups + on-demand backup downloads are built in. If you
ever decide to leave, you take everything with you.

### 2.7 One licence, every module

There is no "Loyalty add-on for $19/month". There is no "Online
ordering add-on for $59/month". There is no "Multi-branch upgrade".

Buy the licence once and you get:

- POS Desktop terminal app (Windows)
- Web POS for tablets / browsers
- Kitchen Display System
- Customer-facing QR self-order
- Public restaurant website
- Reservations
- Customers, discounts, coupons
- Menu, recipes, ingredients, pre-ready, waste log, stock watcher,
  stock reconciliation
- Suppliers, purchasing, shopping list, supplier ledger
- Mushak invoices + register, BIN setup
- Staff, custom roles, cashier permissions matrix
- Attendance with Tipsoi biometric sync, payroll, leave management
- Expenses, liabilities, accounts, daily / sales / items-sold /
  performance / supplies / void-audit / activity-log reports
- Branding & theming, public website CMS
- WhatsApp Cloud API integration, SMS provider integration,
  Facebook auto-posts
- Branches, multi-terminal pairing, device revoke, daily backups

Every module. Every branch. Every terminal you pair. Forever.

---

## 3. The full stack — what's in the box

A flat checklist so you can map your existing tools to ours and see
what you're replacing:

| Replace this | With this Restora POS module |
|---|---|
| Your current POS register | POS Desktop (Windows) / Web POS |
| Paper kitchen tickets / shouting at the chef | Kitchen Display System + section-routed thermal tickets |
| Excel + paper Mushak book | Mushak 6.3 / 6.8 + Mushak Register report |
| Tally / spreadsheet inventory | Ingredients + Recipes + Pre-Ready + Stock Watcher + Stock Reconciliation |
| WhatsApp screenshots to suppliers | WhatsApp PO PDF auto-send + Supplier Ledger |
| Manual Facebook posts | Auto-Facebook posts on discount creation |
| Tablet at the door for online orders | Customer-facing QR self-order, IP-gated |
| Static restaurant website | Built-in website CMS with menu, reviews, reservations |
| Spreadsheet for staff hours | Attendance + Tipsoi biometric sync + Payroll + Leave |
| Spreadsheet for expenses | Expenses + Liabilities + Accounts |
| "Who deleted that?" | Activity Log with per-field before/after diffs |
| Voids on paper | Void Audit report (Returned vs Wasted, value impact) |
| Credentials passed around on chat | Custom roles + Cashier Permissions matrix + per-staff PINs |
| Daily database backup ad-hoc | Daily automated backups + on-demand download |

---

## 4. Feature deep-dive — ten modules

### 4.1 Cashier (POS Desktop)

**What it does.** The Windows Electron app every cashier uses. Order
entry, customer assignment, table assignment, item modifiers, split
payment, void with manager approval (PIN OTP if you choose), bill
printing, cash drawer integration.

**How it works.** Every action is wrapped in an `apiFetch` proxy that
attaches an Idempotency-Key header to every mutation. When online, the
request goes straight to the server; when offline (or the network
flakes mid-request), the proxy synthesises a plausible response and
queues the actual mutation in a SQLite outbox. Receipt and kitchen
tickets are generated client-side and sent to thermal printers via
ESC/POS commands — no print dialog, no driver fight.

**Why it matters to you as the owner.** A cashier hitting "Confirm
Payment" should never see a spinner. With Restora POS, payment confirmation
is always instant — the receipt prints, the drawer kicks, the customer
walks out. The sync to the server happens in the background, and if
the network is genuinely down it'll catch up the moment WiFi returns.

**Where the cheap competition fails.** Cloud-only POS (Square,
Loyverse, Petpooja) freeze the moment connectivity drops. Toast
handles offline payment but on hardware you have to buy from Toast at
US prices. Restora POS runs on any Windows PC + any 80mm ESC/POS
thermal printer + any standard cash drawer.

---

### 4.2 Kitchen — KDS + Section-Routed Thermal Tickets

**What it does.** Two complementary surfaces for the kitchen: a
Web-based Kitchen Display System (a tablet or screen the chefs tap
on), and silent thermal kitchen-ticket printing routed by station
(Grill / Fry / Bar / Dessert). Each section sees only its items.

**How it works.** Menu items are tagged with a Cooking Station. When
an order is placed, the server fans out one ticket per station — to
the KDS for chefs who want a screen, and to the section's assigned
thermal printer for those who want paper. Each ticket carries the full
order context (table, time, modifiers, notes) plus the recipe
ingredients embedded in the JSON, so the chef can see "this Beef
Oyster Rice needs 250g rice + 80g beef" without a separate lookup.

**Why it matters to you as the owner.** Friday-night rush, three
sections going simultaneously, no shouting, no chef walking back to
the printer. Each section sees their items, marks them PREPARING and
DONE on the KDS, and the cashier sees real-time progress. Print
fallback covers the case where a chef prefers paper.

**Where the cheap competition fails.** Generic POS print one ticket
and hope someone reads the headers. Loyverse's KDS is paid-tier and
cloud-routed (drops with WiFi). Toast's section routing is decent but
you pay for it in the platform fee.

---

### 4.3 Inventory & Recipes

**What it does.** The deepest part of the product. Tracks every
ingredient with per-stock-unit + per-purchase-unit cost, parent /
variant hierarchy, recipes that link menu items to ingredient
deductions, pre-ready batch production, waste logging with valuation,
and a Stock Reconciliation workflow for periodic stocktakes.

**How it works.** Every stock movement (PURCHASE / SALE / WASTE /
VOID_RETURN / ADJUSTMENT / OPERATIONAL_USE / PRODUCTION_RECEIVED) is
written as a row in the StockMovement ledger with the per-unit cost
stamped at the moment of write. The ingredient's `currentStock` is
the running total. For variants (e.g. Rice Pack 1kg / 5kg / 25kg), the
parent's stock is the auto-synced sum of the variants. Recipes are
ingredient-line lists per menu item; on order placement the server
computes the deduction and writes one SALE row per ingredient.

The Stock Watcher report gives you a per-ingredient activity ledger
with a date range — every PURCHASE, SALE, WASTE, ADJUSTMENT row
itemised, with money values, opening / closing stock, and the
suppliers / orders / staff associated with each row. Stock
Reconciliation lets you print a count sheet (recently moved items at
the top, dormant at the bottom), walk the storeroom, type the actuals
back in, and submit — every variance becomes a WASTE row (with a
reason you choose) or an ADJUSTMENT row, and stock is updated to match.

**Why it matters to you as the owner.** End-of-month variance:
"we bought 8.4 kg of Spring Onion and only sold 1.4 kg via menu items
— where did the rest go?" The Stock Watcher report tells you exactly:
purchases by supplier and date, sales by menu item and order, waste
by reason and recorder, adjustments by staff member. The Stock
Reconciliation page closes the loop on the "what's actually on the
shelf right now" question once a month.

**Where the cheap competition fails.** Most POS at this price track
ingredients as a flat list, no variants, no recipe cost roll-up,
no pre-ready, no waste valuation. You end up keeping inventory in a
spreadsheet — and a spreadsheet doesn't decrement on every sale.

---

### 4.4 Procurement — Suppliers, Purchasing, Shopping List, WhatsApp PO

**What it does.** Manage suppliers, generate purchase orders, send
them to suppliers, receive stock against them, track the supplier
ledger (every PO + receipt + payment + balance).

**How it works.** Every supplier has a record with contact info,
WhatsApp number, payment terms, opening balance. POs are line-item
priced; on send, the system generates a PDF, attaches it to a
WhatsApp Cloud API message, and posts it to the supplier's number.
On receive, line items are checked off; stock auto-increments; the
per-unit cost from the PO is stamped onto every PURCHASE StockMovement
row so cost-of-goods reports stay accurate.

The Shopping List is a cross-supplier view: it sums up every "below
minimum stock" ingredient and lets you split it across suppliers
based on past pricing.

**Why it matters to you as the owner.** Most POS make procurement an
afterthought — a separate page nobody uses. Restora POS makes it the
front door of inventory: every PURCHASE flows through a PO, every PO
sits in the supplier ledger, every supplier ledger settles in WhatsApp
where you already are.

**Where the cheap competition fails.** Toast / Square / Petpooja
all have purchasing modules but none integrate with WhatsApp.
Loyverse barely has purchasing. Local BD POS often have crude
purchasing and zero ledger.

---

### 4.5 Bangladesh Compliance — Mushak 6.3 / 6.8

**What it does.** Issues NBR-compliant tax invoices on every paid
order, NBR-compliant credit / debit notes on every refund. Maintains
the Mushak Register the inspector asks for. Validates BIN at branch
setup.

**How it works.** Each branch has a `bin` and `branchCode` configured.
On payment, the order's transaction commits and an `issueInvoiceForOrder`
call runs inside the same transaction — generates the next sequential
serial atomically (one SQL statement, can't race), formats it, freezes
the entire invoice as a JSON snapshot, and writes the Mushak Invoice
row. Refunds run the mirror flow with the credit / debit note shape.
The Mushak Register report aggregates every invoice + note in a date
range, sorted, totalled, ready for handover.

**Why it matters to you as the owner.** Audits stop being scary. The
inspector arrives, you click Print on the Mushak Register, you hand
them the printout. Every figure traces back to a real paid order.
Every serial is sequential. There are no gaps. There are no
duplicates. There are no "we'll fix this in Excel" stories.

**Where the cheap competition fails.** Toast doesn't know what Mushak
is. Square doesn't know what Mushak is. Loyverse doesn't know what
Mushak is. Petpooja knows India GST, not Bangladesh Mushak. Local BD
POS sometimes have Mushak but rarely with atomic serial generation —
which means under load they reuse or skip serials and you find out at
the audit.

---

### 4.6 Multi-channel ordering

**What it does.** Three ways customers reach you: in-store via a
cashier (POS Desktop), self-serve via a QR code on every table (no
app install), and online via the public website (optional).

**How it works.** QR self-order is a mobile web page the customer
scans into. Orders are tagged with the table, sit in the same Order
table as cashier-entered orders, fan out to the same kitchen tickets,
get paid via the same Mushak flow. IP gating restricts QR ordering to
your branch's WiFi (so customers can't order from outside) — useful
for dine-in-only restaurants. The public website pulls live menu,
images, reviews from the same admin; if you enable online ordering,
those orders flow into the same pipeline too.

**Why it matters to you as the owner.** Customer who's been waiting
for the waiter for 10 minutes? They scan the QR and order themselves.
The kitchen sees the ticket; the cashier sees the bill. You don't
hire a separate "online ordering platform" — same database, same
reports, same Mushak compliance.

**Where the cheap competition fails.** QR ordering exists in Toast
and Petpooja but their integration usually means paying a per-order
take rate. Square has it but locked to the Square ecosystem. Loyverse
doesn't really do it. None of them IP-gate to a branch — they assume
you want delivery aggregator orders too.

---

### 4.7 Customers & Marketing — DB, Discounts, Coupons, Auto-Facebook, SMS

**What it does.** Customer database with phone-number normalisation
(so `01620307630` and `+8801620307630` are the same customer).
Discounts (per-cashier, per-item, per-category), coupons (QR
redeemable with use-limit + expiry), automatic Facebook posts on
discount creation, SMS notifications.

**How it works.** Customer records are keyed by normalised phone.
Discounts attach to either an order, a category, or specific menu
items. Coupons are redeemable codes (also QR) with usage caps. When
you create a discount, the Social module (per-minute cron) generates
a Facebook post — discount name, value, menu item image, copy — and
posts it to your configured page. SMS sends transactional messages
through your configured provider (Twilio, local BD providers).

**Why it matters to you as the owner.** "Mid-week 20% off Biryani" —
in most POS you create the discount and then go open Facebook and
write a post. In Restora POS you create the discount; the Facebook
post auto-posts within a minute; the cashier sees the discount on
their POS; the customer who already follows your page sees the post.
Same workflow, half the steps.

**Where the cheap competition fails.** None of them auto-post to
Facebook. Toast and Petpooja have loyalty / marketing modules as paid
add-ons. Loyverse's loyalty is tier-locked. Square's marketing is a
separate app.

---

### 4.8 People — Staff, Custom Roles, Attendance, Payroll, Leave

**What it does.** Staff management with role-based permissions, a
Cashier Permissions matrix that fine-tunes what each role can do at
the POS, custom roles that overlay the base roles, attendance with
optional Tipsoi biometric sync, payroll calculation with deductions
and bonuses, leave management with approval workflows.

**How it works.** Base roles (OWNER / MANAGER / ADVISOR / CASHIER /
KITCHEN / WAITER) gate every endpoint at the controller level. The
Cashier Permissions matrix lives on top — for example, even a CASHIER
might need MANAGER approval to apply a discount above 10%. Custom
Roles are admin-defined overlays: "Head Chef Dhaka" might see fewer
admin pages than "Head Chef Chittagong". Attendance can be manual or
auto-synced hourly from a Tipsoi biometric machine. Payroll calculates
salary + deductions + bonuses and tracks it through Accounts.

**Why it matters to you as the owner.** "Who can void an item?" "Who
can apply a 50% discount?" "Who can issue a refund?" — every one of
these is a knob you can turn per-branch, per-role, per-staff-member.
And every change to those knobs is logged in the Activity Log so you
can audit who changed what when.

**Where the cheap competition fails.** Toast and Square have role
systems but they're rigid (the roles you get are the roles you get).
Custom roles + per-branch overrides + a separate Cashier Permissions
matrix on top is something most POS don't even attempt.

---

### 4.9 Finance — Expenses, Liabilities, Accounts, Reports

**What it does.** Track expenses (utilities, rent, food cost, staff
cost, ad spend), liabilities (loans, rent owed, utility arrears),
accounts (cash in hand, bank balances, receivables). Generate the
reports that tell you whether you're making money: daily, sales,
items-sold, performance, supplies, void audit, Mushak register.

**How it works.** Expenses post to an Account; receipts post to an
Account; the Account ledger is a live running balance. Liabilities
are scheduled obligations with due dates. Reports run against the
underlying transactions — no overnight ETL, no stale dashboard.

**Why it matters to you as the owner.** Most restaurants run blind:
they know revenue (the POS prints it daily) but not profit. With
Restora POS you can answer "what's my actual food-cost percentage on
Beef Oyster Rice?" because the recipe cost roll-up is live; "what's
my labour-cost percentage this month?" because payroll is in the same
system; "what did I spend on electricity this quarter?" because
expenses are categorised.

**Where the cheap competition fails.** Toast and Petpooja have
finance modules as paid add-ons. Square has rudimentary expenses.
Loyverse barely has finance. None of them bundle liabilities.

---

### 4.10 Audit & Trust — Activity Log, Void Audit, Permissions

**What it does.** Every admin-config change is logged with actor,
timestamp, before-and-after diff. Every voided item is in the Void
Audit report with reason, approver, mode (returned to stock vs
wasted), and money impact. Every endpoint is role-gated. Every
desktop terminal can be revoked.

**How it works.** A global ActivityLogService captures `before` and
`after` snapshots on every mutation, builds a per-field diff, scrubs
sensitive fields (passwords, tokens, PINs), and persists. The admin
Activity Log page renders the diff field-by-field — recipe edits show
"Spring Onion: 20g → 50g + Garlic added", menu edits show
"Cost Per Unit: 12.50 → 15.00", with cuids and Decimals
auto-formatted to readable values. Auto-purges after 90 days.

The Void Audit report splits voided items into two buckets: those
returned to stock (no kitchen loss — cashier mistake) and those logged
as waste (food gone — kitchen loss). For each, the selling-price
total. For the wasted bucket, the actual ingredient-cost loss.

**Why it matters to you as the owner.** "Why is my food cost
percentage suddenly higher this week?" — the Void Audit shows you
that someone's voiding-as-waste 12 times a day. "Who changed the
discount cap last Tuesday?" — Activity Log, takes 5 seconds. Audit
trails are the difference between catching theft in week one and
catching it in month nine.

**Where the cheap competition fails.** Toast has audit logs but
they're shallow. Square's are limited to specific events. Loyverse
and Petpooja barely have one. None of them split voids by mode the
way the Void Audit does.

---

## 5. How we compare

The full side-by-side lives in [`comparison.md`](./comparison.md). The
summary:

- Every cell where Restora POS has ✅ and three+ competitors have ❌ is
  a feature **built specifically for the way Bangladesh restaurants
  operate**: NBR Mushak, WhatsApp procurement, intermittent internet,
  self-hosted infrastructure.
- Toast is the closest in feature depth — but it's US-first,
  hardware-locked, and SaaS-priced.
- Petpooja is the closest in regional fit — but it's India-VAT-first,
  cloud-only, and SaaS-priced.
- Loyverse / Square are entry-level — fine for a coffee cart, not for
  a real restaurant.

---

## 6. The cost story

We're not going to quote a price in this document — pricing is best
discussed once we know your branch count and terminal count. But here's
the framing.

**A typical mid-market POS subscription is USD 79–299 per month, per
location.** Three terminals across two branches, twelve months a year,
five years: **USD 5,000–18,000 in subscription fees alone**, before
hardware, before payment processing fees, before add-ons. And at the
end of five years you own nothing — stop paying, and the software
locks.

**Restora POS is a one-time licence.** You pay once. You get every
module listed in §3. You can run it on a single VPS that costs a few
thousand taka per month. You can run it on hardware you already own —
any 80mm ESC/POS thermal printer, any Windows-compatible cash drawer.
You can scale to as many terminals as you can pair without paying
per-seat.

**Five-year TCO comparison (illustrative):**

| Cost item | SaaS POS (Toast / Petpooja tier) | Restora POS |
|---|---|---|
| Software, 5 years | USD 5,000–18,000 | One-time licence |
| Hardware lock-in | Yes (proprietary) | No (any ESC/POS + Windows) |
| Per-add-on fees | Loyalty / online order / payroll | All bundled |
| Per-branch fees | Yes | No |
| Per-terminal fees | Often yes | No |
| Hosting | Their cloud (you pay forever) | Your VPS (a few thousand ৳/mo) |

The total-cost-of-ownership delta over five years is large enough that
most owners pay back the licence in the first quarter alone — and own
the system for free thereafter.

---

## 7. Who Restora POS is for (and who it isn't)

**Built for:**

- Independent dine-in restaurants, **5–80 covers**.
- Cafés, quick-service, cloud kitchens.
- Small chains, **2–10 branches**.
- Bangladesh restaurants needing **NBR Mushak compliance**.
- Owners who want to **own their data** and **host on their own
  infrastructure**.

**Not the right fit for:**

- 50+ branch enterprise chains — no franchise tooling, no
  centralised purchasing across hundreds of locations.
- Food trucks — no GPS routing or moving-location handling.
- Grocery / retail — no barcode scanning, no SKU-driven inventory.
- Owners who want a SaaS dashboard they never have to think about —
  Restora POS is more powerful, but you do need to set up your own
  VPS (or have a partner do it for you).

---

## 8. Day 1 → Month 1 — what go-live looks like

A realistic implementation timeline. Most restaurants are taking
orders within 48 hours of buying.

| When | What | Time |
|---|---|---|
| **Day 0** | Install on your VPS via the Install Wizard (Postgres + Node) | 1–2 hours |
| **Day 1** | Pair the first terminal, load menu, configure printers | 3 hours |
| **Day 2** | Train cashiers on PIN login + order entry | 2 hours |
| **Week 1** | Go live — Mushak invoices auto-issuing on every payment | — |
| **Week 2** | Configure kitchen sections + recipes + supplier list | 4–6 hours |
| **Month 1** | Coupons + auto-Facebook + attendance + payroll + reports | 6–8 hours |

If you're switching from another POS, we can help with menu / customer
data import in the first week. After that, the system is yours to run.

---

## 9. Trust & security

- **Self-hosted.** Your data never leaves your VPS unless you decide
  to move it.
- **DPAPI-encrypted device credentials.** Every Windows terminal stores
  its server URL + tokens encrypted with the OS's per-user keychain.
- **bcrypt-hashed cashier PINs.** Never stored in plaintext, never
  reversible.
- **Idempotent server endpoints.** The desktop outbox can replay any
  mutation without double-writing — every endpoint that matters is
  idempotent on its Idempotency-Key.
- **Activity Log.** Every admin-config change is attributable to a
  specific user with a specific timestamp and a specific before/after
  diff.
- **Daily automated database backups.** Plus on-demand backup
  download — you always have a copy.
- **Per-row role gates.** Every API endpoint is guarded by `@Roles()`
  decorators that the JWT payload is checked against.
- **Sensitive-field scrubbing in audit logs.** Passwords, tokens,
  PINs are replaced with `***` before any audit row is persisted.

---

## 10. Get started

Tell us:

1. How many branches you operate today.
2. How many cashier terminals + kitchen displays you'd want.
3. Whether you already have a VPS, or want a recommendation.
4. Whether you need a data migration from your current POS.

We'll come back with:

- A licence quote.
- An installation timeline.
- A menu / data migration plan if needed.
- A demo of the modules most relevant to your operation.

---

> **Restora POS** is the restaurant operating system you'd build for
> yourself if you had a year of evenings free. We did. You don't have
> to.

---

*This document is the canonical sales pitch for Restora POS. Every
claim about Mushak compliance, offline behaviour, cost stamping, audit
logging, and synthetic-id binding is backed by code in this
repository. A technical reviewer can audit each claim against the
modules listed in [`comparison.md`](./comparison.md) and the
implementation in `apps/api/src/`, `apps/admin/src/`, and
`apps/pos-desktop/src/`.*
