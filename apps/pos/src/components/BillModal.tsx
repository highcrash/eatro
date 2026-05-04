import { useEffect } from 'react';
import { X, Printer } from 'lucide-react';

import type { Order } from '@restora/types';
import { formatCurrency, shortOrderCode } from '@restora/utils';
import { useBranding } from '../lib/branding';
import { printReceiptSmart } from '../lib/print-receipt';

interface BillModalProps {
  order: Order;
  onClose: () => void;
}

export default function BillModal({ order, onClose }: BillModalProps) {
  const { data: branding } = useBranding();
  const brandName = branding?.name ?? 'Restora';
  const subtotal = Number(order.subtotal);
  const tax = Number(order.taxAmount);
  const total = Number(order.totalAmount);
  const activeItems = order.items.filter((i) => !i.voidedAt);

  const now = new Date().toLocaleString('en-BD', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Auto-focus so Escape closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePrint = () => void printReceiptSmart(order, branding ?? undefined, { openCashDrawer: false });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white w-[380px] flex flex-col shadow-2xl max-h-[90vh]">
        {/* Screen-only header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DDD9D3] no-print">
          <div>
            <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">
              Bill Preview
            </p>
            <h2 className="font-display text-2xl tracking-wide text-[#111]">
              #{shortOrderCode(order.id)}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#999] hover:text-[#111] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Bill content — printed */}
        <div className="bill-print-area overflow-auto flex-1 px-6 py-5 font-body text-sm space-y-4">
          {/* Header */}
          <div className="text-center space-y-0.5">
            <p className="font-display text-2xl tracking-widest text-[#111]">{brandName.toUpperCase()}</p>
            <p className="text-xs text-[#999]">Bill / Check</p>
            {branding?.address && <p className="text-[10px] text-[#999]">{branding.address}</p>}
            {branding?.phone && <p className="text-[10px] text-[#999]">Tel: {branding.phone}</p>}
            {branding?.billHeaderText && <p className="text-[10px] text-[#666] mt-1">{branding.billHeaderText}</p>}
          </div>

          {/* Meta */}
          <div className="flex justify-between text-xs text-[#999] border-t border-dashed border-[#DDD9D3] pt-3">
            <span>{order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'}</span>
            <span>{now}</span>
          </div>
          <p className="text-xs text-[#999]">Order #{shortOrderCode(order.id)}</p>

          {/* Items */}
          <div className="border-t border-dashed border-[#DDD9D3] pt-3 space-y-2">
            <div className="flex justify-between text-xs text-[#999] uppercase tracking-widest mb-1">
              <span>Item</span>
              <span>Amount</span>
            </div>
            {activeItems.map((item) => (
              <div key={item.id}>
                <div className="flex justify-between">
                  <span className="flex-1 mr-2 text-[#111]">
                    {item.quantity}× {item.menuItemName}
                    <span className="text-[#999] ml-1 text-xs">
                      @ {formatCurrency(Number(item.unitPrice))}
                    </span>
                  </span>
                  <span className="shrink-0 text-[#111]">
                    {formatCurrency(Number(item.totalPrice))}
                  </span>
                </div>
                {item.notes && <p className="text-[10px] text-[#999] italic ml-4">→ {item.notes}</p>}
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-dashed border-[#DDD9D3] pt-3 space-y-1.5">
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
            <div className="flex justify-between font-display text-xl tracking-wide text-[#111] pt-1 border-t border-[#DDD9D3]">
              <span>TOTAL DUE</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <p className="text-center text-xs text-[#999] pt-2">
            Please pay at the counter. Thank you!
          </p>
          {branding?.billFooterText && (
            <p className="text-center text-[10px] text-[#666] whitespace-pre-line border-t border-dashed border-[#DDD9D3] pt-2">
              {branding.billFooterText}
            </p>
          )}
        </div>

        {/* Screen-only actions */}
        <div className="px-6 pb-6 pt-2 flex gap-3 no-print">
          <button
            onClick={onClose}
            className="flex-1 border border-[#DDD9D3] py-2.5 text-sm font-body text-[#666] hover:border-[#111] transition-colors"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 bg-[#111] hover:bg-[#333] text-white py-2.5 text-sm font-body font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Printer size={14} />
            Print Bill
          </button>
        </div>
      </div>
    </div>
  );
}
