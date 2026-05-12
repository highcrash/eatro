# Your Restaurant POS vs the Field

A scannable side-by-side. Rows pre-chosen for the Bangladesh restaurant
operator: NBR compliance, offline survival, the cost of running it for
five years, and the operational depth that decides whether the kitchen
runs on the software or around it.

| Capability | **Your Restaurant POS** | Toast | Square POS | Loyverse | Petpooja |
|---|:---:|:---:|:---:|:---:|:---:|
| Mushak 6.3 invoice issuance (atomic serial) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mushak 6.8 credit / debit notes on refund | ✅ | ❌ | ❌ | ❌ | ❌ |
| BIN validation + frozen invoice JSON snapshot | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mushak Register report (NBR-ready) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Offline order entry — full payment & receipt** | ✅ | Partial¹ | Partial¹ | ❌ | ❌ |
| Cash-drawer kick on cash payment (no driver dialog) | ✅ | ✅ | ✅ | ❌ | Partial |
| Silent ESC/POS thermal printing (kitchen + bill) | ✅ | ✅ | ✅ | Partial² | ✅ |
| Section-routed kitchen tickets (Grill / Fry / Bar…) | ✅ | ✅ | Partial | ❌ | ✅ |
| Recipes with parent / variant ingredient roll-up | ✅ | Partial | ❌ | Partial | ✅ |
| Pre-ready batch production (FIFO, expiry, waste link) | ✅ | ❌ | ❌ | ❌ | Partial |
| Stock Reconciliation print-and-count sheet | ✅ | ❌ | ❌ | ❌ | ❌ |
| WhatsApp PO PDF auto-sent to supplier | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-Facebook post when a discount is created | ✅ | ❌ | ❌ | ❌ | ❌ |
| QR self-order, IP-gated to branch Wi-Fi | ✅ | ✅ | ✅ | ❌ | ✅ |
| Multi-branch with per-branch settings + roles | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-terminal pairing + remote revoke | ✅ | ✅ | ✅ | ✅ | ✅ |
| Custom roles overlay (e.g. "Head Chef Dhaka" ≠ "Head Chef Ctg") | ✅ | ❌ | ❌ | ❌ | ❌ |
| Per-row activity audit log with field-level diffs | ✅ | Partial | Partial | ❌ | ❌ |
| Tipsoi biometric attendance auto-sync | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configurable salary structures (EARNING + DEDUCTION components, per-structure thresholds) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configurable leave rules (per-type accrual + balance tracking) | ✅ | Add-on | Add-on | ❌ | Add-on |
| Payroll + Leave management bundled | ✅ | Add-on | Add-on | ❌ | Add-on |
| Loyalty programme bundled (points + rolling expiry + QR redemption) | ✅ | Add-on³ | Add-on⁴ | Tier-locked | Add-on |
| Per-customer single-use coupon campaigns (filter → unique codes → reviewed batch send) | ✅ | ❌ | ❌ | ❌ | Partial |
| First-visit welcome coupon auto-attached to payment SMS | ✅ | ❌ | ❌ | ❌ | ❌ |
| Customer balance card inside customer-facing QR app | ✅ | ❌ | ❌ | ❌ | ❌ |
| Liabilities & Accounts ledger bundled | ✅ | Add-on | ❌ | ❌ | Add-on |
| Self-hosted on your own server | ✅ | ❌ | ❌ | ❌ | ❌ |
| Your data — never leaves your VPS | ✅ | ❌ | ❌ | ❌ | ❌ |
| Pricing model | **One-time licence** | $79–$299/mo per location | 2.6%–3.5% per txn + h/w | Free tier + add-ons | SaaS subscription |
| Hardware lock-in | Any 80mm ESC/POS | Toast-only h/w | Square-only h/w | Open | Mostly open |

¹ "Partial offline": these systems can keep entering orders offline but
   payment processing, receipt printing or Mushak issuance often degrade
   and the cashier sees error states the customer sees too.
² Loyverse prints via the Loyverse Printer service which routes through
   the cloud — drops alongside the network.
³ Toast Loyalty is a paid module — tiered subscription on top of the
   per-location plan.
⁴ Square Loyalty is a separate paid app billed per location after a
   trial.

---

## Where the cheap tier specifically fails

**Toast** — the most feature-complete in this list, but locked to Toast
hardware, US-payments-first, $79–$299/mo per location forever, and zero
NBR-Mushak support. A 3-branch BD restaurant burns ৳ lakhs / year just
on the software.

**Square POS** — generous free tier on paper, but the per-transaction
fee (2.6%–3.5%) eats more on a busy day than a SaaS subscription would
have. No Mushak, no thermal printer fanning to multiple kitchen
sections, no recipe stack worth the name.

**Loyverse** — beautiful entry-level POS with a strong free tier.
Stops being free the moment you want a kitchen display, multi-branch
analytics, or employee management. Cloud-only — when WiFi drops, the
register is paper. No Mushak.

**Petpooja** — by far the strongest South-Asia regional player.
Recipe / ingredient depth is real. But: SaaS-priced, India-VAT-first
(no Mushak), no offline-first desktop, no WhatsApp PO PDF, no
auto-Facebook, no per-row activity log with diffs.

**Local BD POS (representative)** — ShopUp / Foodi / BPoS / dozens of
Excel-VBA contraptions. Some do Mushak adequately. Almost none do all
of: offline-first, multi-channel, multi-branch, recipe roll-up, WhatsApp
procurement, audit log, custom roles, biometric attendance, payroll
bundled, *and* expose the source so you're not held hostage by the
vendor.

---

## Bangladesh-market head-to-head

Two BD-positioned SaaS competitors keep showing up in evaluations:
**ChillyPOS** (chillypos.com) and **Restora POS SaaS** (restorapos.com
— same product name as another Bangladesh product, cloud-only). Both
are real products with their own strengths. Here's the focused
side-by-side.

| Capability | **Your Restaurant POS** | ChillyPOS | Restora POS SaaS |
|---|:---:|:---:|:---:|
| Deployment | **Self-hosted on your VPS** | Cloud-only SaaS | Cloud-only SaaS |
| Pricing | **One-time licence** | 1,000–2,000 BDT / branch / month | Monthly / yearly subscription |
| You own the data | ✅ | ❌ (vendor cloud) | ❌ (vendor cloud) |
| Mushak 6.3 / 6.8 (atomic serial + register) | ✅ | ❌ | ❌ (not advertised) |
| Offline order entry — full payment & Mushak issuance | ✅ | ❌ | Claimed (vague) |
| Recipe roll-up with parent / variant ingredients | ✅ | ❌ | ❌ |
| Pre-ready batch production (FIFO + expiry + waste link) | ✅ | ❌ | ❌ |
| Stock Reconciliation (print + count + variance) | ✅ | ❌ | ❌ |
| WhatsApp PO PDF auto-sent to suppliers | ✅ | ❌ | ❌ |
| Auto-Facebook post on discount creation | ✅ | ❌ | ❌ |
| Tipsoi biometric attendance auto-sync | ✅ | ❌ | ❌ |
| Configurable salary structures (components + thresholds) | ✅ | ❌ | ❌ |
| Configurable leave rules (per-type accrual + balances) | ✅ | Basic HRM only | Basic HR only |
| Per-row activity audit log with field-level diffs | ✅ | ❌ | ❌ |
| Custom roles overlay + Cashier Permissions matrix | ✅ | ❌ | ❌ |
| Loyalty programme with rolling-expiry + QR redemption | ✅ | "Loyalty & discount" | ❌ |
| Per-customer single-use coupon campaigns (filter → unique codes → reviewed batch send) | ✅ | "Target SMS marketing" | ❌ |
| First-visit welcome coupon auto-attached to payment SMS | ✅ | ❌ | ❌ |
| Customer balance card inside customer-facing QR app | ✅ | ❌ | ❌ |
| Margin-band protected ad-hoc QR customisation | ✅ | ❌ | ❌ |
| Section-routed kitchen tickets (Grill / Fry / Bar…) with recipe in ticket | ✅ | KDS, not section-routed | KDS, not section-routed |
| Native mobile waiter ordering app | ⚠️ (web POS on tablet) | ❌ | ✅ |
| Third-party delivery aggregator integration (Foodpanda / Pathao) | ⚠️ (API exposed, no native connector) | ❌ | ✅ |
| AI-labelled analytics | ⚠️ (Performance Report + ledger depth — same data, no buzzword) | ✅ ("AI Insight + sentiment") | ❌ |
| Free trial | ❌ (one-time licence; demo available) | ❌ | ✅ (21-day) |

### What ChillyPOS leads on

- **AI-labelled features**: "AI Insight and analytics", "AI food
  suggestions", "Customer sentiment analysis". These are real
  marketing claims. Our answer: we ship the **underlying data** that
  any AI would need to draw conclusions from — Performance Report
  with margin per item, void audit by reason code, activity log with
  field-level diffs, ingredient price volatility tracking. If you
  want sentiment analysis, our review data is structured and
  exportable. We don't market a buzzword we can't audit; we ship
  the data layer that lets you run the analysis any way you want.
- **Daily SMS + email sales report**: we have the Daily Report
  inside the admin panel but don't auto-push it as SMS / email.
  Pull-based instead of push-based. A one-cron-job extension if you
  want it.

### What Restora POS SaaS leads on

- **Native mobile waiter ordering app**: a dedicated phone app for
  waiters to take orders at the table. Our position: the web POS
  runs fine on any tablet browser, supports offline, and doesn't
  need an app-store install (or update cycle, or device pairing
  per phone). For dine-in volume below ~150 covers / shift this is
  equivalent or better. If you need 8+ waiters running phones at
  the same time, that's a roadmap item.
- **Third-party delivery aggregator integration**: native
  Foodpanda / Pathao Food connectors. Our position: we deliberately
  optimise for direct-channel revenue (QR self-order, website
  ordering, dine-in) because aggregator orders typically take 25-35%
  off the top. The API is documented; a Foodpanda webhook bridge
  is a side-project, not a missing core feature. If aggregator
  channel is critical, talk to us about the connector.
- **21-day free trial**: we offer scheduled live demos with a sample
  database loaded with your menu. Different shape: less DIY, more
  hand-holding. Conversion rates are higher this way and you don't
  waste 21 days exploring a database you'll throw away.

### Where Your Restaurant POS wins decisively against both

- **Mushak compliance** — *neither* BD SaaS competitor publicly
  advertises Mushak 6.3 issuance with atomic serials, Mushak 6.8
  credit-note flow, or the Mushak Register report. This is the
  single most important feature for any BD restaurant that takes
  NBR audits seriously. You can't win an NBR audit with a
  generic-cloud POS.
- **Offline-first that actually works** — ChillyPOS is cloud-only;
  Restora POS SaaS *claims* offline but offers no detail on
  Mushak-offline, idempotency-keyed mutations, or thermal printing
  without server contact. Our offline path is documented down to
  the SQLite outbox + DPAPI-encrypted credentials + Idempotency-Key
  replay protection. WiFi drop = your cashier never sees a spinner.
- **Operational depth** — recipe roll-up, pre-ready batch FIFO,
  stock reconciliation, WhatsApp procurement, auto-Facebook posts,
  custom roles overlay, configurable salary structures + leave
  rules, audit log with field-level diffs. *Each one* is a feature
  some restaurants make a hiring decision around. Both BD
  competitors miss the whole stack.
- **Loyalty done right** — rolling expiry (resets each visit so
  active diners don't get punished), per-customer single-use coupon
  campaigns (one unique code per recipient, two-step reviewed send),
  first-visit welcome coupon (auto-attached to the payment SMS),
  customer balance card *inside* the QR ordering app. None of this
  is in either competitor's product page.
- **You own everything** — code on your VPS, database under your
  control, backups in your hands. Stop paying one day and the
  software keeps running. Try that with a SaaS lock-in.

### Honest acknowledgements

We don't claim a perfect feature ladder. Three things to call out:

1. **No native mobile waiter app yet.** We push web POS on tablets;
   a dedicated phone-waiter app is in the roadmap, not the shipping
   product.
2. **No native Foodpanda / Pathao connectors.** Direct-channel is
   our focus. If aggregator volume is critical, plan for a custom
   webhook bridge or wait for the connector.
3. **No 21-day self-serve trial.** We do scheduled live demos
   instead. Owners get more out of a 30-minute walkthrough on their
   own data than fighting an unfamiliar admin panel for three weeks.

---

## Where Your Restaurant POS wins

The pattern is consistent: every cell where Your Restaurant POS has ✅ and at
least three competitors have ❌ is a feature **built for the way
Bangladesh restaurants actually operate** — Mushak compliance,
WhatsApp procurement, intermittent internet, owners who want to host
on their own VPS instead of trusting a foreign cloud.

That's not an accident. That's the product.

---

> **Want to verify a row?** Every ✅ on this table maps to a working
> module in the codebase. The README links to the relevant
> controllers / services so a technical evaluator can audit the claims
> before buying.
