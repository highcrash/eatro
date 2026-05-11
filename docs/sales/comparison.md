# Your Restaurant POS vs the Field

A scannable side-by-side. Rows pre-chosen for the Bangladesh restaurant
operator: NBR compliance, offline survival, the cost of running it for
five years, and the operational depth that decides whether the kitchen
runs on the software or around it.

| Capability | **Your Restaurant POS** | Toast | Square POS | Loyverse | Petpooja |
|---|:---:|:---:|:---:|:---:|:---:|
| Mushak 6.3 invoice issuance (atomic serial) | âœ… | âŒ | âŒ | âŒ | âŒ |
| Mushak 6.8 credit / debit notes on refund | âœ… | âŒ | âŒ | âŒ | âŒ |
| BIN validation + frozen invoice JSON snapshot | âœ… | âŒ | âŒ | âŒ | âŒ |
| Mushak Register report (NBR-ready) | âœ… | âŒ | âŒ | âŒ | âŒ |
| **Offline order entry â€” full payment & receipt** | âœ… | PartialÂ¹ | PartialÂ¹ | âŒ | âŒ |
| Cash-drawer kick on cash payment (no driver dialog) | âœ… | âœ… | âœ… | âŒ | Partial |
| Silent ESC/POS thermal printing (kitchen + bill) | âœ… | âœ… | âœ… | PartialÂ² | âœ… |
| Section-routed kitchen tickets (Grill / Fry / Barâ€¦) | âœ… | âœ… | Partial | âŒ | âœ… |
| Recipes with parent / variant ingredient roll-up | âœ… | Partial | âŒ | Partial | âœ… |
| Pre-ready batch production (FIFO, expiry, waste link) | âœ… | âŒ | âŒ | âŒ | Partial |
| Stock Reconciliation print-and-count sheet | âœ… | âŒ | âŒ | âŒ | âŒ |
| WhatsApp PO PDF auto-sent to supplier | âœ… | âŒ | âŒ | âŒ | âŒ |
| Auto-Facebook post when a discount is created | âœ… | âŒ | âŒ | âŒ | âŒ |
| QR self-order, IP-gated to branch Wi-Fi | âœ… | âœ… | âœ… | âŒ | âœ… |
| Multi-branch with per-branch settings + roles | âœ… | âœ… | âœ… | âœ… | âœ… |
| Multi-terminal pairing + remote revoke | âœ… | âœ… | âœ… | âœ… | âœ… |
| Custom roles overlay (e.g. "Head Chef Dhaka" â‰  "Head Chef Ctg") | âœ… | âŒ | âŒ | âŒ | âŒ |
| Per-row activity audit log with field-level diffs | âœ… | Partial | Partial | âŒ | âŒ |
| Tipsoi biometric attendance auto-sync | âœ… | âŒ | âŒ | âŒ | âŒ |
| Payroll + Leave management bundled | âœ… | Add-on | Add-on | âŒ | Add-on |
| Liabilities & Accounts ledger bundled | âœ… | Add-on | âŒ | âŒ | Add-on |
| Self-hosted on your own server | âœ… | âŒ | âŒ | âŒ | âŒ |
| Your data â€” never leaves your VPS | âœ… | âŒ | âŒ | âŒ | âŒ |
| Pricing model | **One-time licence** | $79â€“$299/mo per location | 2.6%â€“3.5% per txn + h/w | Free tier + add-ons | SaaS subscription |
| Hardware lock-in | Any 80mm ESC/POS | Toast-only h/w | Square-only h/w | Open | Mostly open |

Â¹ "Partial offline": these systems can keep entering orders offline but
   payment processing, receipt printing or Mushak issuance often degrade
   and the cashier sees error states the customer sees too.
Â² Loyverse prints via the Loyverse Printer service which routes through
   the cloud â€” drops alongside the network.

---

## Where the cheap tier specifically fails

**Toast** â€” the most feature-complete in this list, but locked to Toast
hardware, US-payments-first, $79â€“$299/mo per location forever, and zero
NBR-Mushak support. A 3-branch BD restaurant burns à§³ lakhs / year just
on the software.

**Square POS** â€” generous free tier on paper, but the per-transaction
fee (2.6%â€“3.5%) eats more on a busy day than a SaaS subscription would
have. No Mushak, no thermal printer fanning to multiple kitchen
sections, no recipe stack worth the name.

**Loyverse** â€” beautiful entry-level POS with a strong free tier.
Stops being free the moment you want a kitchen display, multi-branch
analytics, or employee management. Cloud-only â€” when WiFi drops, the
register is paper. No Mushak.

**Petpooja** â€” by far the strongest South-Asia regional player.
Recipe / ingredient depth is real. But: SaaS-priced, India-VAT-first
(no Mushak), no offline-first desktop, no WhatsApp PO PDF, no
auto-Facebook, no per-row activity log with diffs.

**Local BD POS (representative)** â€” ShopUp / Foodi / BPoS / dozens of
Excel-VBA contraptions. Some do Mushak adequately. Almost none do all
of: offline-first, multi-channel, multi-branch, recipe roll-up, WhatsApp
procurement, audit log, custom roles, biometric attendance, payroll
bundled, *and* expose the source so you're not held hostage by the
vendor.

---

## Where Your Restaurant POS wins

The pattern is consistent: every cell where Your Restaurant POS has âœ… and at
least three competitors have âŒ is a feature **built for the way
Bangladesh restaurants actually operate** â€” Mushak compliance,
WhatsApp procurement, intermittent internet, owners who want to host
on their own VPS instead of trusting a foreign cloud.

That's not an accident. That's the product.

---

> **Want to verify a row?** Every âœ… on this table maps to a working
> module in the codebase. The README links to the relevant
> controllers / services so a technical evaluator can audit the claims
> before buying.
