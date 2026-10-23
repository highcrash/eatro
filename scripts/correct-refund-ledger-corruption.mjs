#!/usr/bin/env node
// Correction script for the refund crash + account-corruption bug
// (see docs/refund-ledger-bug-report.md for the full writeup).
//
// Before the fix, refundOrder() reversed account balances via
// `updateAccountForPayment(..., 'REFUND' as never, ...)` with a NEGATIVE
// amount. 'REFUND' is not a member of TransactionType, so the
// accountTransaction.create() call that should have recorded the reversal
// always threw — but the account.update() just before it always
// succeeded, and because the amount was negative, non-SALE's
// `delta = -amount` math *increased* the balance instead of decreasing it.
// Net effect per affected refund: the linked account's balance ends up
// `2 * share` too high (it moved +share instead of -share), and there is
// no AccountTransaction row at all for the reversal.
//
// This script finds every CREDIT MushakNote (= a refund that was issued)
// whose linked account has no matching reversal transaction, and — only
// when --apply is passed — corrects the balance and backfills the missing
// ADJUSTMENT row. It is READ-ONLY (dry run) by default.
//
// Usage:
//   node scripts/correct-refund-ledger-corruption.mjs                  # dry run (default)
//   node scripts/correct-refund-ledger-corruption.mjs --apply          # actually writes
//
// Point DATABASE_URL (via .env or the shell) at whichever database you
// want to check/fix. This script has never been run in --apply mode
// against production by the agent that wrote it — only locally, as a
// correctness demonstration, after an explicit go-ahead. Running it
// against production is the owner's call, after reviewing the dry-run
// output against that database first.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Mirrors AccountService's account-resolution lookup chain exactly (read-only here). */
async function resolveAccount(branchId, paymentOptionCode) {
  const option = await prisma.paymentOption.findFirst({
    where: { branchId, code: paymentOptionCode, isActive: true },
    select: { accountId: true, categoryId: true },
  });

  let account = null;
  if (option?.accountId) {
    account = await prisma.account.findFirst({ where: { id: option.accountId, isActive: true } });
  }
  if (!account) {
    account = await prisma.account.findFirst({
      where: { branchId, linkedPaymentMethod: paymentOptionCode, isActive: true },
    });
  }
  if (!account && option?.categoryId) {
    const cat = await prisma.paymentMethodConfig.findFirst({
      where: { id: option.categoryId },
      include: { options: { where: { isDefault: true, isActive: true }, select: { accountId: true } } },
    });
    if (cat?.options[0]?.accountId) {
      account = await prisma.account.findFirst({ where: { id: cat.options[0].accountId, isActive: true } });
    }
    if (!account && cat) {
      account = await prisma.account.findFirst({ where: { branchId, linkedPaymentMethod: cat.code, isActive: true } });
    }
  }
  if (!account) {
    const cat = await prisma.paymentMethodConfig.findFirst({ where: { branchId, code: paymentOptionCode } });
    if (cat?.options?.[0]?.accountId) {
      account = await prisma.account.findFirst({ where: { id: cat.options[0].accountId, isActive: true } });
    }
  }
  return account;
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write to the database ***' : 'Dry run (no writes) — pass --apply to actually correct the ledger.');
  console.log('Database:', (process.env.DATABASE_URL ?? '').replace(/:[^:@]+@/, ':****@'));
  console.log('');

  const notes = await prisma.mushakNote.findMany({
    where: { noteType: 'CREDIT' },
    orderBy: { issuedAt: 'asc' },
  });
  console.log(`Found ${notes.length} CREDIT note(s) (refund events) to check.\n`);

  let affectedCount = 0;
  let totalCorrected = 0;

  for (const note of notes) {
    const order = await prisma.order.findUnique({
      where: { id: note.orderId },
      include: { payments: true },
    });
    if (!order) {
      console.log(`[SKIP] Note ${note.serial}: order ${note.orderId} no longer exists.`);
      continue;
    }

    const refundTotal = Math.abs(note.totalInclVat.toNumber());
    const paymentTotal = order.payments.reduce((s, p) => s + p.amount.toNumber(), 0) || 1;

    for (const payment of order.payments) {
      const share = Math.round((payment.amount.toNumber() / paymentTotal) * refundTotal * 100) / 100;
      if (share <= 0) continue;

      const account = await resolveAccount(order.branchId, payment.method);
      if (!account) {
        console.log(`[SKIP] Note ${note.serial}, order ${order.orderNumber}: no account linked to payment method "${payment.method}" — nothing was ever posted, nothing to fix.`);
        continue;
      }

      // The fixed code's reversal always includes the note's serial in its
      // description — a reliable, order-specific marker to detect whether
      // this exact refund was already (correctly) reversed.
      const existingReversal = await prisma.accountTransaction.findFirst({
        where: { accountId: account.id, description: { contains: note.serial } },
      });
      if (existingReversal) {
        console.log(`[OK]   Note ${note.serial}, order ${order.orderNumber}: already correctly reversed on account "${account.name}" (${existingReversal.type} ${existingReversal.amount}).`);
        continue;
      }

      affectedCount++;
      const correctiveDelta = -2 * share; // undo the wrong +share, then apply the correct -share
      const correctedBalance = account.balance.toNumber() + correctiveDelta;
      console.log(`[BUG]  Note ${note.serial}, order ${order.orderNumber}: account "${account.name}" (${account.id})`);
      console.log(`       current balance ${account.balance.toString()} is too HIGH by ${(2 * share).toFixed(2)} (should be too high by 0)`);
      console.log(`       would set balance -> ${correctedBalance.toFixed(2)}, and insert one ADJUSTMENT row of ${(-share).toFixed(2)}`);

      if (APPLY) {
        await prisma.$transaction([
          prisma.account.update({
            where: { id: account.id },
            data: { balance: { increment: correctiveDelta } },
          }),
          prisma.accountTransaction.create({
            data: {
              branchId: order.branchId,
              accountId: account.id,
              type: 'ADJUSTMENT',
              amount: -share,
              description: `Refund for order #${order.orderNumber} (${note.serial}) [backfilled by correction script]`,
              createdAt: note.issuedAt,
            },
          }),
        ]);
        totalCorrected++;
        console.log('       -> applied.');
      }
      console.log('');
    }
  }

  console.log(`\n${affectedCount} affected payment-reversal(s) found.`);
  if (!APPLY && affectedCount > 0) {
    console.log('Re-run with --apply to correct them.');
  } else if (APPLY) {
    console.log(`${totalCorrected} corrected.`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
