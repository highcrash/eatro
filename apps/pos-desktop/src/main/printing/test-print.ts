import type { KitchenTicketInput } from '@restora/utils';
import { printKitchenTicket } from './kitchen';
import { printReceipt, type ReceiptInput } from './receipt';
import { printA4Report } from './a4-report';

/** Send a short sample print to the named slot so the cashier can verify
 *  paper, connection, character set, and (for the bill slot) the cash-drawer kick. */
export async function testPrint(slot: 'kitchen' | 'bill' | 'reports'): Promise<void> {
  if (slot === 'kitchen') {
    const sample: KitchenTicketInput = {
      orderNumber: 'TEST-001',
      tableNumber: 'T1',
      type: 'DINE_IN',
      createdAt: new Date(),
      notes: 'This is a test print — ignore',
      items: [
        { quantity: 2, menuItemName: 'Grilled Chicken', notes: 'extra spicy' },
        { quantity: 1, menuItemName: 'Fried Rice' },
      ],
    };
    await printKitchenTicket(sample);
    return;
  }

  if (slot === 'bill') {
    const sample: ReceiptInput = {
      brandName: 'RESTORA POS',
      branchName: 'Test Branch',
      branchAddress: '123 Sample St',
      branchPhone: '+000 000-0000',
      orderNumber: 'TEST-001',
      tableNumber: 'T1',
      type: 'DINE_IN',
      createdAt: new Date(),
      cashierName: 'Test Cashier',
      items: [
        { quantity: 2, menuItemName: 'Grilled Chicken', unitPrice: 450, lineTotal: 900 },
        { quantity: 1, menuItemName: 'Fried Rice', unitPrice: 250, lineTotal: 250 },
      ],
      subtotal: 1150,
      taxAmount: 57.5,
      totalAmount: 1207.5,
      paymentMethod: 'CASH',
      footerText: '** TEST PRINT — not a real receipt **',
    };
    await printReceipt(sample, { openCashDrawer: true });
    return;
  }

  if (slot === 'reports') {
    const html = `<html><head><style>
      body { font-family: system-ui, sans-serif; padding: 40px; }
      h1 { margin: 0 0 8px; }
      .kicker { letter-spacing: 4px; text-transform: uppercase; color: #888; font-size: 11px; margin: 0; }
      .box { border: 1px solid #ccc; padding: 16px; margin-top: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      td, th { padding: 8px; border-bottom: 1px solid #eee; text-align: left; }
    </style></head><body>
      <p class="kicker">Your Restaurant POS — Reports printer test</p>
      <h1>Test Print</h1>
      <p>Printed at ${new Date().toLocaleString()}</p>
      <div class="box">
        <h3>Sample sales summary</h3>
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>
            <tr><td>Grilled Chicken</td><td>12</td><td>5,400.00</td></tr>
            <tr><td>Fried Rice</td><td>18</td><td>4,500.00</td></tr>
            <tr><td>Drinks</td><td>30</td><td>2,100.00</td></tr>
          </tbody>
        </table>
      </div>
      <p style="margin-top:40px;color:#888;font-size:12px">If this page came out clean, your A4 reports printer is ready.</p>
    </body></html>`;
    await printA4Report(html);
    return;
  }

  throw new Error(`Unknown printer slot: ${String(slot)}`);
}
