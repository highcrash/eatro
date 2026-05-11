# Your Restaurant POS — The Restaurant Operating System

**The restaurant POS built for how Bangladesh actually runs.**

Mushak-compliant out of the box. Works when the internet doesn't. One
licence, every module included, your server, your data.

> 12-minute read · For owners and managers of dine-in restaurants,
> cafés, cloud kitchens, and small chains in Bangladesh and South Asia.

---

## Contents

1. [Why we built this](#1-why-we-built-this)
2. [What's different about Your Restaurant POS — the seven signals](#2-whats-different-about-restora-pos--the-seven-signals)
3. [The full stack — what's in the box](#3-the-full-stack--whats-in-the-box)
4. [Feature deep-dive — eleven modules](#4-feature-deep-dive--eleven-modules)
5. [How we compare](#5-how-we-compare)
6. [The cost story](#6-the-cost-story)
7. [Who Your Restaurant POS is for (and who it isn't)](#7-who-restora-pos-is-for-and-who-it-isnt)
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

**Your Restaurant POS is built for that exact stack of problems.** It's not a
generic POS we localised — it's a POS designed from day one around
NBR-Mushak compliance, intermittent internet, WhatsApp-as-supply-chain,
and the deep ingredient hierarchy a real Bangladesh kitchen needs.

---

## 2. What's different about Your Restaurant POS — the seven signals

Seven things that would, individually, be reason to choose Your Restaurant POS. Together, they're a different kind of product.

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

Most POS in this price bracket track ingredients as a flat list. Your Restaurant POS tracks them as a hierarchy:

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

In Bangladesh, suppliers don't read email. They read WhatsApp. Your Restaurant POS is the only POS in this comparison that knows that:

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
discount in the admin panel, Your Restaurant POS can auto-generate a Facebook
post — discount name, value, menu item image — and queue it to your
configured page. A per-minute background worker handles delivery and
retries. Default off per branch; flip it on once and discounts publish
themselves.

### 2.6 Self-hosted, you-own-your-data

Your Restaurant POS runs on your own server. A single VPS handles a
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

| Replace this | With this Your Restaurant POS module |
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

## 4. Feature deep-dive — eleven modules

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
Payment" should never see a spinner. With Your Restaurant POS, payment confirmation
is always instant — the receipt prints, the drawer kicks, the customer
walks out. The sync to the server happens in the background, and if
the network is genuinely down it'll catch up the moment WiFi returns.

**Where the cheap competition fails.** Cloud-only POS (Square,
Loyverse, Petpooja) freeze the moment connectivity drops. Toast
handles offline payment but on hardware you have to buy from Toast at
US prices. Your Restaurant POS runs on any Windows PC + any 80mm ESC/POS
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

#### Recipe Management — the part most POS skip

A recipe in Your Restaurant POS is not just a textual list — it's the live
blueprint the system uses to deduct stock on every sale, value waste
on every void, compute cost-of-goods on every report, and gate
margin-aware pricing on every customisation.

- **Cost roll-up is live, not cached.** Every line carries the
  ingredient's per-stock-unit cost. The total cost-per-serving is
  computed on demand from current ingredient costs — when your tomato
  supplier raises prices on Monday, every recipe that uses tomato
  reflects it on Monday. No nightly job, no "Recalculate Costs"
  button to remember.
- **Variant-aware ingredient lines.** Add "Chicken" to a recipe and
  Your Restaurant POS resolves to the right variant (Free Range vs Standard) at
  the moment the order is placed — pulling FIFO from whichever
  variant has stock. No stockouts because the recipe couldn't see the
  alternative.
- **Pre-ready components are first-class.** A recipe can reference a
  pre-ready item (semi-cooked dough, marinated meat, base sauce)
  exactly like a raw ingredient. The pre-ready batch FIFOs out as
  orders consume it. One pre-ready item can power dozens of menu
  items.
- **Recipes per variant.** A parent menu item like "Espresso" with
  variants "Single" / "Double" / "Triple" carries one recipe per
  variant. A built-in **Copy From** dialog clones a recipe between
  variants in one click — you don't re-type the base.
- **Bulk import / export from Excel.** Two CSV modes: per-item (load
  one menu item's recipe from a file) and bulk multi-item (one row
  per ingredient line, grouped by menu item). The same file format
  also exports — download every recipe, edit in Excel, re-upload to
  replace. Fuzzy ingredient matching by name or item code so column
  drift doesn't break the load.
- **Kitchen tickets carry the recipe.** Chefs see exactly what to
  pull from the line — "Beef Oyster Rice = 250 g rice + 80 g beef
  + 30 g spring onion" — without a separate lookup.

The kicker: every customer customisation that comes through the QR
app or the cashier ("no onions", "extra cheese") is interpreted
against the recipe at sale time. Removed lines skip the deduction;
added lines are deducted from the ad-hoc ingredient. Your stock
column tells the truth even when half the orders ask for
modifications.

---

### 4.4 Custom Menu — let cashiers invent, then promote what sells

**What it does.** Custom Menu is the parallel track for one-off
dishes a cashier builds on the fly during service — a regular who
wants "burger with smoked cheese instead of cheddar and add bacon",
a chef's-special the kitchen invents for a private function, a
seasonal special that hasn't been formalised on the printed menu yet.

**How it works.** When a cashier picks **Custom Order** at the POS,
they pick a base item (or start from blank), tick or untick recipe
lines, add ad-hoc ingredients at a surcharge, set the selling price,
and send the line to the kitchen. The system captures the whole
composition — the recipe at that moment in time, the cost computed
from the ingredients used, the price the cashier set, and the
customer who got it. Every custom dish lives on the Custom Menu
admin page with: times sold, lifetime revenue, computed COGS, gross
margin %, last-sold date.

When a custom dish proves itself ("we've sold 14 Smoked-Cheese
Burgers in two weeks at a 62% margin"), the admin clicks **Promote to
Menu** and it becomes a permanent menu item with that recipe and
price baked in. No retype. No remeasure. No "let's add it to the
menu next month".

**Why it matters to you as the owner.** Menus aren't designed once
and frozen — they evolve from what customers actually order and what
chefs actually invent during service. Custom Menu captures that
evolution automatically. You see what's selling that isn't on the
menu yet; you see what margins those improvisations are running at;
you promote the winners. Your menu becomes a living document instead
of a quarterly redesign exercise.

**Gross margin on selling, not markup on cost.** Your Restaurant POS uses
the *gross margin on selling price* formula
(`(Price - Cost) / Price × 100`) — the standard restaurant industry
metric, not the markup-on-cost number that flatters cheap items.
60% gross margin means 40% of selling price went to ingredient cost,
which is exactly what you compare across menu items.

**Where the cheap competition fails.** Toast / Square / Loyverse /
Petpooja have menu management — you sit in admin, design items,
publish. None of them capture cashier improvisation as a first-class
data shape, none auto-compute the margin on it, and none let you
promote a winning improvisation to the menu in one click.

---

### 4.5 Procurement — Suppliers, Purchasing, Shopping List, WhatsApp PO

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
afterthought — a separate page nobody uses. Your Restaurant POS makes it the
front door of inventory: every PURCHASE flows through a PO, every PO
sits in the supplier ledger, every supplier ledger settles in WhatsApp
where you already are.

**Where the cheap competition fails.** Toast / Square / Petpooja
all have purchasing modules but none integrate with WhatsApp.
Loyverse barely has purchasing. Local BD POS often have crude
purchasing and zero ledger.

---

### 4.6 Bangladesh Compliance — Mushak 6.3 / 6.8

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

### 4.7 Multi-channel ordering

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

**The Customise dialog — remove ingredients, add ingredients, pay
the right surcharge.** Every line in the QR cart opens a Customise
dialog with two sections. The top section lists every ingredient in
the dish's recipe as a checkbox — the customer can tick off
"onions", "coriander", "chilli" and the kitchen ticket prints "NO
ONIONS, NO CORIANDER" while the recipe-deduction engine skips those
ingredients from the stock pull. The bottom section is "Add something"
— the customer picks any ingredient your branch stocks
("avocado", "extra cheese", "double bacon"), sets a quantity and
unit, and pays a surcharge. The system enforces a per-branch
margin band on every ad-hoc addition: the surcharge must sit inside
the floor (your minimum acceptable margin) and the ceiling (your
maximum) you configured in admin, so customers can't accidentally
overpay and you can't accidentally undercharge for a costly add-on.
The added ingredient is deducted from stock at sale, costed properly
on the order, and surfaced separately in reports.

**Why it matters to you as the owner.** Customer who's been waiting
for the waiter for 10 minutes? They scan the QR and order themselves.
The kitchen sees the ticket with their exact modifications; the
cashier sees the bill with the surcharges; your stock column tells
the truth even when every third order has a "no onions, add cheese"
modification. You don't hire a separate "online ordering platform" —
same database, same reports, same Mushak compliance, same recipe
engine deducting and valuing the same way regardless of channel.

**Where the cheap competition fails.** QR ordering exists in Toast
and Petpooja but their integration usually means paying a per-order
take rate, and modifiers are flat "add sauce" lists pre-configured
by the admin — no customer can add an arbitrary ingredient. Square
has it but locked to the Square ecosystem. Loyverse doesn't really
do it. None of them IP-gate to a branch — they assume you want
delivery aggregator orders too. And none enforce a margin band on
ad-hoc customisations.

---

### 4.8 Customers & Marketing — DB, Discounts, Coupons, Auto-Facebook, SMS

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
write a post. In Your Restaurant POS you create the discount; the Facebook
post auto-posts within a minute; the cashier sees the discount on
their POS; the customer who already follows your page sees the post.
Same workflow, half the steps.

**Where the cheap competition fails.** None of them auto-post to
Facebook. Toast and Petpooja have loyalty / marketing modules as paid
add-ons. Loyverse's loyalty is tier-locked. Square's marketing is a
separate app.

---

### 4.9 People — Staff, Custom Roles, Attendance, Payroll, Leave

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

### 4.10 Finance — Accounts auto-management, Performance, Reports

**What it does.** Track expenses (utilities, rent, food cost, staff
cost, ad spend), liabilities (loans, rent owed, utility arrears),
accounts (cash in hand, bank balances, receivables). Generate the
reports that tell you whether you're making money: daily, sales,
items-sold, performance, supplies, void audit, Mushak register.

#### Accounts auto-management — the ledger writes itself

Every account in Your Restaurant POS (Cash Register, Bank, bKash, Nagad,
Receivables, Expense buckets) has a live running balance. The
balance is not maintained by an accountant typing entries — it is
maintained by the system, automatically, every time money moves.

- **Every paid order auto-posts.** A bill paid in cash increases the
  Cash Register account. A bill paid in bKash increases the bKash
  account. A bill paid across two methods splits the posting
  proportionally. Each posting writes an `AccountTransaction` row
  of type SALE with the order number in the description, so the
  ledger reads back like a journal an auditor can follow.
- **Every expense auto-posts.** Record an electricity bill payment;
  the Expenses account credits, the Cash (or bank) account debits.
  Same for rent, supplier payments, staff payroll runs — payment
  methods route to the right account, the ledger updates, the
  running balance is correct.
- **Wrong tender? One click to fix.** If a cashier picks Cash when
  the customer actually paid bKash, the Correct Payment flow runs
  a reversal: posts an `ADJUSTMENT` against the original account,
  then a fresh SALE against the right one. Both entries stay in
  the ledger so you can audit what happened.
- **Inter-account transfers.** End-of-day cash deposit to the bank:
  Transfer ৳50,000 from Register to Bank, the system writes a
  matched OUT/IN pair, both balances update, the audit trail is
  unbroken.
- **The P&L report is a snapshot, not a manual exercise.** Pick a
  date range and Your Restaurant POS computes revenue (broken down by
  payment method), purchasing cost (sum of received POs), gross
  profit, operating expenses (by category), payroll, and net
  profit — alongside a closing balance snapshot of every account.
  Daily. Monthly. Per branch. No ETL pipeline, no overnight job.

The wow moment: every restaurant's accountant is currently
double-entering numbers from the POS receipt printer into a Tally
file. With Your Restaurant POS, the ledger is already the journal — the
accountant becomes a reviewer, not a typist.

#### Performance Report — which item, which category, which cost is moving

The Performance Report is the analytical centrepiece for an owner
deciding what to keep on the menu and where margin is leaking.

- **By Menu Item.** Quantity sold, gross revenue, computed COGS
  from the live recipe roll-up, gross profit in ৳, gross margin %.
  Sorted by impact. Spot the dish you sell 200 of that's running
  on a 12% margin — you're paying the kitchen to lose money on
  every plate.
- **By Category.** Same metrics rolled up to Mains / Sides /
  Beverages / Desserts. A drinks category at 75% margin is a
  different conversation than a curries category at 38% — the
  report shows both at a glance.
- **Inventory Price Volatility.** Per-ingredient: min cost, mean
  cost, max cost, latest cost, number of receipts in the date
  range, and a trend arrow if the latest cost has shifted more
  than 5% from the mean. The single biggest signal for "we need
  to renegotiate this supplier" — or "we need to raise the menu
  price on items that use tomato".
- **Print-friendly.** One-click print to A4 or save-as-PDF for
  the monthly review meeting.

Most POS show you revenue. Your Restaurant POS shows you the **margin
geography of your menu** — and the cost volatility that's eating
it from underneath.

**Why it matters to you as the owner.** Most restaurants run blind:
they know revenue (the POS prints it daily) but not profit. With
Your Restaurant POS you can answer "what's my actual food-cost percentage on
Beef Oyster Rice?" because the recipe cost roll-up is live; "what's
my labour-cost percentage this month?" because payroll is in the same
system; "what did I spend on electricity this quarter?" because
expenses are categorised; "is my Cash Register matching the deposit
I made to the bank?" because both accounts are in the same ledger.

**Where the cheap competition fails.** Toast and Petpooja have
finance modules as paid add-ons. Square has rudimentary expenses.
Loyverse barely has finance. None of them auto-post every sale and
every expense to a live account ledger; none compute per-item COGS
+ margin from a live recipe roll-up; none show ingredient cost
volatility. You end up with a spreadsheet and a Tally file and an
accountant on a retainer. Your Restaurant POS replaces the spreadsheet.

---

### 4.11 Audit & Trust — Activity Log, Void Audit, Permissions

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

- Every cell where Your Restaurant POS has ✅ and three+ competitors have ❌ is
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

**Your Restaurant POS is a one-time licence.** You pay once. You get every
module listed in §3. You can run it on a single VPS that costs a few
thousand taka per month. You can run it on hardware you already own —
any 80mm ESC/POS thermal printer, any Windows-compatible cash drawer.
You can scale to as many terminals as you can pair without paying
per-seat.

**Five-year TCO comparison (illustrative):**

| Cost item | SaaS POS (Toast / Petpooja tier) | Your Restaurant POS |
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

## 7. Who Your Restaurant POS is for (and who it isn't)

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
  Your Restaurant POS is more powerful, but you do need to set up your own
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

> **Your Restaurant POS** is the restaurant operating system you'd build for
> yourself if you had a year of evenings free. We did. You don't have
> to.

---

*This document is the canonical sales pitch for Your Restaurant POS. Every
claim about Mushak compliance, offline behaviour, cost stamping, audit
logging, and synthetic-id binding is backed by code in this
repository. A technical reviewer can audit each claim against the
modules listed in [`comparison.md`](./comparison.md) and the
implementation in `apps/api/src/`, `apps/admin/src/`, and
`apps/pos-desktop/src/`.*
