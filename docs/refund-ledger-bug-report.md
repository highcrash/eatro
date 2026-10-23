# Refund crash + account-ledger corruption — fix and data audit

## The bug (fixed in this PR)

`OrderService.refundOrder()` (`apps/api/src/order/order.service.ts`) reversed
account balances via:

```ts
void this.accountService.updateAccountForPayment(
  branchId, p.method, -share, 'REFUND' as never, description,
);
```

Two independent problems:

1. **Crash.** `'REFUND'` is not a member of the `TransactionType` enum
   (`SALE | EXPENSE | PURCHASE_PAYMENT | TRANSFER | ADJUSTMENT` —
   `prisma/schema.prisma`). `accountTransaction.create()` always rejected.
   The call was `void`-fired with no `.catch`, so the rejection was
   unhandled — Node's default behavior is to exit the process on an
   unhandled rejection, taking down the whole API (every till, kitchen
   screen, and QR order on the branch) until the platform restarted it.
2. **Wrong direction.** `updateAccountForPayment` computes
   `delta = type === 'SALE' ? amount : -amount`. A negative `amount`
   (`-share`) through the non-SALE branch produces `delta = +share` — the
   balance **increases** on refund instead of decreasing. The
   `account.update` (balance change) runs *before* the `accountTransaction.create`
   that throws, so the wrong-direction balance change commits even though
   the transaction record — and the whole request — never does.

Net effect per affected refund: the linked account's balance ends up
**`2 × share` too high** (it moved `+share` instead of `-share`), with
**no `AccountTransaction` row** recording the event at all.

### The fix

- Use `accountService.reverseSalePosting(branchId, paymentOptionCode, amount, description)`
  — the same helper `correctOrderPayment` already uses to undo a prior SALE
  posting — passing a **positive** `share`. It records the reversal as
  `ADJUSTMENT` (its doc comment already notes the enum has no REFUND
  value) and decrements the balance.
- Added `.catch()` to this call and to the stock-restore call just below
  it, logging via a new `OrderService` logger instead of leaving the
  rejection unhandled.
- Removed the `as never` cast.
- Added a process-level `unhandledRejection` handler in `apps/api/src/main.ts`
  as a backstop — logs and keeps the process up instead of crashing. This
  codebase has dozens of other `void this.someService.method(...)`
  fire-and-forget calls with no `.catch()` (stock deduction, account
  postings, SMS, direct `prisma.customer.update` calls); none of them are
  currently known to pass an invalid value, but any one of them failing
  for *any* reason (a transient DB hiccup, a future bug) would crash the
  process today exactly the same way. This doesn't fix those call sites —
  it stops the failure mode from being a full outage while they get found
  and fixed individually.

### `as never` audit (requested)

Searched every `as never` cast in `apps/api/src`. The refund one above was
the only cast on a value not actually in its target enum. Everything else
checked out:

- Most are Prisma `select`/`data`/`include` object-shape casts (a
  recurring TS-inference quirk with nested selects in this Prisma
  version), not enum-value coercions.
- `order.service.ts` `newStatus as never` (→ `REFUNDED`/`PARTIALLY_REFUNDED`)
  — both valid `OrderStatus` members.
- `order.service.ts` `dto.method as never` on `OrderPayment.method` — that
  field is a plain `String` in Prisma, not an enum; no DB-level validation
  exists either way.
- `sms.service.ts`'s `'QUEUED'/'SENT'/'FAILED'/...` casts — all valid
  `SmsStatus`/`SmsKind` members.
- Query-param-driven casts (`purchasing.service.ts:28`, `order.service.ts:198`)
  run inside normal awaited request handlers, not fire-and-forget calls —
  an invalid value there 500s that one request, it doesn't crash the
  process. Worth hardening with input validation separately, but it's a
  different risk class from the refund bug.

## Data audit — local/dev database only

Per the brief, this check was run against the **local dev database only**
(`postgresql://127.0.0.1:5434/restora_dev`) — production was not queried.

Found via `mushak_notes` rows of type `CREDIT` (one row per refund event
ever issued):

| Note serial | Order | Issued | Refund amount |
|---|---|---|---|
| `2627/DHK/NOTE/000001` | `ORD-20261024-4365` | 2026-10-23 20:19:02 | 966.00 (96,600 paisa) |

Exactly **one** CREDIT note exists locally — this is almost certainly the
reproduction mentioned in the bug report ("refunding an item on a local
demo copy: the API process died"), left in its post-crash state.

**Confirmed corrupted**, matching the predicted pattern exactly:

- Order `ORD-20261024-4365` paid 227,900 paisa by `CARD`, which resolves
  (via the same account-lookup chain `AccountService` uses) to account
  `acc-pos` ("Visa/Master POS").
- `acc-pos.updatedAt` is `2026-10-23T20:19:02.561Z` — 17ms after the
  note's `issuedAt` — confirming the balance write happened, then the
  process (or at least that request) died before the transaction row
  could be written.
- **No `AccountTransaction` row** exists referencing this order or note —
  the most recent transaction on `acc-pos` from that timestamp window is
  the *original* sale (`SALE 227900`), with nothing after it until the
  next day's unrelated sales.
- Current balance: 33,473,050 paisa. Expected (had the refund posted
  correctly): 33,279,850 paisa. **Off by +193,200 paisa (1,932.00) — almost
  exactly double the refund amount**, exactly as predicted: it went up by
  the refund instead of down by it.

No other branches or CREDIT notes exist in this database, so this is the
full extent of local corruption.

## Correction script

`scripts/correct-refund-ledger-corruption.mjs` — **read-only (dry run) by
default.** For every CREDIT note, it recomputes the same per-payment
`share` the refund flow computed, resolves the linked account via the
exact same lookup chain `AccountService` uses, and checks whether a
reversal transaction already exists (matched by the note's serial, which
the fixed code always includes in its description). If one is missing, it
reports the exact balance correction and backfill transaction it *would*
apply — nothing is written unless `--apply` is passed explicitly.

Dry-run output against the local database (reproduced above in table
form):

```
[BUG]  Note 2627/DHK/NOTE/000001, order ORD-20261024-4365: account "Visa/Master POS" (acc-pos)
       current balance 33473050 is too HIGH by 193200.00 (should be too high by 0)
       would set balance -> 33279850.00, and insert one ADJUSTMENT row of -96600.00

1 affected payment-reversal(s) found.
```

**This script has not been run in `--apply` mode anywhere, including
locally** — it's handed over as a dry-run-verified tool, pending your
decision on whether/how to run it. It connects to whatever `DATABASE_URL`
it's given; running it against production is your call, after reviewing
a dry run against production's own data first (which I have not done —
no production access was used at any point in this investigation).
