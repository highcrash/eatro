# Restora POS vs the Field

A scannable side-by-side. Rows pre-chosen for the Bangladesh restaurant
operator: NBR compliance, offline survival, the cost of running it for
five years, and the operational depth that decides whether the kitchen
runs on the software or around it.

| Capability | **Restora POS** | Toast | Square POS | Loyverse | Petpooja |
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

## Where Restora POS wins

The pattern is consistent: every cell where Restora POS has ✅ and at
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
