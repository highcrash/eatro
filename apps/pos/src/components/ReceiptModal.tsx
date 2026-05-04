import { useEffect, useRef, useState } from 'react';
import { X, Printer } from 'lucide-react';

import type { Order } from '@restora/types';
import { formatCurrency, shortOrderCode } from '@restora/utils';
import { useBranding } from '../lib/branding';
import { isDesktop, printReceiptSmart } from '../lib/print-receipt';

interface ReceiptModalProps {
  order: Order;
  cashReceived: number; // paisa; equals totalAmount for non-cash
  onDone: () => void;
}

export default function ReceiptModal({ order, cashReceived, onDone }: ReceiptModalProps) {
  const { data: branding } = useBranding();
  const brandName = branding?.name ?? 'Restora';
  const total = Number(order.totalAmount);
  const subtotal = Number(order.subtotal);
  const tax = Number(order.taxAmount);
  const change = order.paymentMethod === 'CASH' ? cashReceived - total : 0;
  const [printError, setPrintError] = useState<string | null>(null);
  const autoPrintedRef = useRef(false);

  // Auto-fire the print + cash-drawer kick exactly once per mount when
  // running inside the Electron desktop shell. The manual Print button stays
  // as a reprint option. In the browser (no desktop wrapper) the cashier
  // still clicks Print themselves — we don't force a dialog on them.
  useEffect(() => {
    if (!isDesktop()) return;
    if (autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    void printReceiptSmart(order, branding ?? undefined, { cashReceived }).then((res) => {
      if (!res.ok) setPrintError(res.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePrint() {
    setPrintError(null);
    const res = await printReceiptSmart(order, branding ?? undefined, { cashReceived });
    if (!res.ok) setPrintError(res.message);
  }

  const paidAt = order.paidAt
    ? new Date(order.paidAt).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white w-[380px] flex flex-col shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDD9D3]">
          <div>
            <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">
              Receipt
            </p>
            <h2 className="font-display text-2xl tracking-wide text-[#111]">
              #{shortOrderCode(order.id)}
            </h2>
          </div>
          <button onClick={onDone} className="text-[#999] hover:text-[#111] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Receipt body */}
        <div className="receipt-print-area overflow-auto flex-1 px-6 py-4 space-y-4 font-body text-sm">
          {/* Brand header */}
          <div className="text-center space-y-0.5">
            <p className="font-display text-2xl tracking-widest text-[#111]">{brandName.toUpperCase()}</p>
            {branding?.address && <p className="text-[10px] text-[#999]">{branding.address}</p>}
            {branding?.phone && <p className="text-[10px] text-[#999]">Tel: {branding.phone}</p>}
            {branding?.billHeaderText && <p className="text-[10px] text-[#666] mt-1">{branding.billHeaderText}</p>}
          </div>

          {/* Meta */}
          <div className="flex justify-between text-xs text-[#999] border-t border-dashed border-[#DDD9D3] pt-3">
            <span>{order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}</span>
            <span>{paidAt}</span>
          </div>

          {/* Items */}
          <div className="space-y-2 border-t border-dashed border-[#DDD9D3] pt-3">
            {order.items.map((item) => (
              <div key={item.id}>
                <div className="flex justify-between">
                  <span className="text-[#111] flex-1 mr-2">
                    {item.quantity}× {item.menuItemName}
                  </span>
                  <span className="text-[#666] shrink-0">
                    {formatCurrency(Number(item.totalPrice))}
                  </span>
                </div>
                {item.notes && <p className="text-[10px] text-[#999] italic ml-4">→ {item.notes}</p>}
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-dashed border-[#DDD9D3] pt-3 space-y-1">
            <div className="flex justify-between text-[#666]">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {Number(order.discountAmount) > 0 && (
              <div className="flex justify-between text-green-700">
                <span>{(order as any).discountName || 'Discount'}{(order as any).couponCode ? ` (${(order as any).couponCode})` : ''}</span>
                <span>-{formatCurrency(Number(order.discountAmount))}</span>
              </div>
            )}
            <div className="flex justify-between text-[#666]">
              <span>VAT</span>
              <span>{formatCurrency(tax)}</span>
            </div>
            {Number((order as { roundAdjustment?: number }).roundAdjustment ?? 0) !== 0 && (
              <div className="flex justify-between text-[#666] text-xs italic">
                <span>Auto Roundup</span>
                <span>
                  {Number((order as { roundAdjustment?: number }).roundAdjustment ?? 0) > 0 ? '+' : '-'}
                  {formatCurrency(Math.abs(Number((order as { roundAdjustment?: number }).roundAdjustment ?? 0)))}
                </span>
              </div>
            )}
            <div className="flex justify-between font-display text-xl tracking-wide text-[#111] pt-1">
              <span>TOTAL</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="border-t border-dashed border-[#DDD9D3] pt-3 space-y-1">
            {order.paymentMethod === 'SPLIT' && order.payments && order.payments.length > 0 ? (
              <>
                <p className="text-xs text-[#999] font-medium tracking-widest uppercase mb-1">Split Payment</p>
                {order.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-[#666]">
                    <span>{p.method}</span>
                    <span>{formatCurrency(Number(p.amount))}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="flex justify-between text-[#666]">
                <span>Method</span>
                <span className="uppercase font-medium">{order.paymentMethod}</span>
              </div>
            )}
            {order.paymentMethod === 'CASH' && (
              <>
                <div className="flex justify-between text-[#666]">
                  <span>Received</span>
                  <span>{formatCurrency(cashReceived)}</span>
                </div>
                <div className="flex justify-between text-[#111] font-medium">
                  <span>Change</span>
                  <span>{formatCurrency(change)}</span>
                </div>
              </>
            )}
          </div>

          <p className="text-center text-xs text-[#999] pt-2">Thank you for your visit!</p>
          {branding?.billFooterText && (
            <p className="text-center text-[10px] text-[#666] whitespace-pre-line border-t border-dashed border-[#DDD9D3] pt-2">
              {branding.billFooterText}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 pt-2 flex flex-col gap-2">
          {printError && (
            <p className="text-[11px] font-body text-[#D62B2B] text-center px-2 py-1 border border-[#D62B2B]/30 bg-[#D62B2B]/5">
              Print failed: {printError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => void handlePrint()}
              className="flex-1 border border-[#DDD9D3] py-2.5 text-sm font-body text-[#666] hover:border-[#111] hover:text-[#111] transition-colors flex items-center justify-center gap-2"
            >
              <Printer size={14} />
              {isDesktop() ? 'Reprint' : 'Print'}
            </button>
            <button
              onClick={onDone}
              className="flex-1 bg-[#111] text-white py-2.5 text-sm font-body font-medium hover:bg-[#333] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
