import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import { useBranding, resolveLogoUrl } from '../lib/branding';

interface DisplayOrder {
  id: string;
  orderNumber: string;
  status: string;
  tableNumber: string | null;
  subtotal: number;
  discountAmount: number;
  discountName: string | null;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  items: Array<{ id: string; menuItemName: string; quantity: number; unitPrice: number; totalPrice: number }>;
}

/**
 * Customer-facing display. Meant to run on a second screen, cheap
 * tablet, or the built-in secondary output on the terminal PC. Polls
 * the active order for a given table every 2 seconds and renders
 * brand-forward layout: logo → itemized cart → running total →
 * "thank you" once paid.
 *
 * No auth needed — this route is deliberately inside the POS app
 * (already requires login), and the display simply reads what the
 * cashier is ringing up.
 *
 * Two usage modes:
 *   /customer-display/:tableId — pin to a specific table (typical for
 *     a counter-seat setup where the customer stays at one spot).
 *   /customer-display          — idle logo + a short "flash the QR
 *     ordering link" hint.
 */
export default function CustomerDisplayPage() {
  const { tableId } = useParams<{ tableId?: string }>();
  const { data: branding } = useBranding();
  const logoUrl = resolveLogoUrl(branding?.logoUrl ?? branding?.posLogoUrl);
  const brandName = branding?.name ?? 'Your Restaurant';

  // Public endpoint — no auth required, so the customer-facing device
  // can sit on its own (tablet / separate login) without needing to
  // sign in as a cashier.
  const { data: order = null, isLoading } = useQuery<DisplayOrder | null>({
    queryKey: ['customer-display', tableId],
    queryFn: () => api.get<DisplayOrder | null>(`/orders/display/${tableId}`),
    enabled: !!tableId,
    refetchInterval: 2000,
    staleTime: 0,
  });

  // The endpoint excludes PAID/VOID; a null order right after checkout is
  // treated as "just paid" to briefly show the thank-you screen.
  const isPaid = !order && !isLoading && !!tableId;
  const items = order?.items ?? [];
  const total = order?.totalAmount ?? 0;
  const subtotal = order?.subtotal ?? 0;
  const vat = order?.taxAmount ?? 0;
  const serviceCharge = order?.serviceChargeAmount ?? 0;
  const discount = order?.discountAmount ?? 0;

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-theme-body flex flex-col">
      {/* Header — brand */}
      <header className="flex flex-col items-center justify-center py-8 border-b-2 border-theme-accent">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-32 max-w-[480px] object-contain mb-4" />
        ) : null}
        <h1 className="font-theme-display text-5xl tracking-[0.4em] uppercase text-theme-accent">{brandName}</h1>
        {branding?.websiteTagline && (
          <p className="text-theme-text-muted font-theme-body text-lg mt-2">{branding.websiteTagline}</p>
        )}
      </header>

      {/* Body */}
      <main className="flex-1 px-12 py-10">
        {!tableId || (!order && !isLoading) ? (
          <IdleScreen brandName={brandName} />
        ) : isPaid ? (
          <PaidScreen total={total} />
        ) : (
          <CartView
            items={items}
            subtotal={subtotal}
            discount={discount}
            serviceCharge={serviceCharge}
            vat={vat}
            total={total}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-theme-border py-3 text-center text-theme-text-muted font-theme-body text-sm tracking-widest uppercase">
        {order ? `Order #${order.orderNumber}` : 'Your Restaurant POS'}
      </footer>
    </div>
  );
}

function IdleScreen({ brandName }: { brandName: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <p className="font-theme-display text-7xl tracking-widest text-theme-text mb-4">WELCOME</p>
      <p className="font-theme-body text-2xl text-theme-text-muted max-w-2xl">
        The cashier will start your order in a moment. Thank you for visiting {brandName}.
      </p>
    </div>
  );
}

function PaidScreen({ total }: { total: number }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <p className="font-theme-display text-8xl tracking-widest text-theme-pop mb-6">THANK YOU</p>
      {total > 0 && (
        <p className="font-theme-body text-3xl text-theme-text">
          Paid {formatCurrency(total)}
        </p>
      )}
      <p className="font-theme-body text-lg text-theme-text-muted mt-4">We hope to see you again soon.</p>
    </div>
  );
}

function CartView({
  items,
  subtotal,
  discount,
  serviceCharge,
  vat,
  total,
}: {
  items: Array<{ id: string; quantity: number; menuItemName: string; unitPrice: number; totalPrice: number }>;
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  total: number;
}) {
  return (
    <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-6 gap-y-3 text-xl">
          <div className="font-theme-body text-sm tracking-widest uppercase text-theme-text-muted col-span-4 border-b border-theme-border pb-2 mb-2 grid grid-cols-[auto_1fr_auto_auto] gap-x-6">
            <span>Qty</span>
            <span>Item</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Total</span>
          </div>
          {items.length === 0 && (
            <p className="col-span-4 text-theme-text-muted font-theme-body text-2xl text-center py-16">
              Waiting for cashier…
            </p>
          )}
          {items.map((it) => (
            <div key={it.id} className="contents">
              <span className="font-theme-body font-bold text-theme-accent">{it.quantity}×</span>
              <span className="font-theme-body">{it.menuItemName}</span>
              <span className="font-theme-body text-theme-text-muted text-right">{formatCurrency(Number(it.unitPrice))}</span>
              <span className="font-theme-body text-right">{formatCurrency(Number(it.totalPrice))}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t-2 border-theme-accent pt-5 mt-5 space-y-2">
        <Row label="Subtotal" value={formatCurrency(subtotal)} />
        {discount > 0 && <Row label="Discount" value={`-${formatCurrency(discount)}`} muted />}
        {serviceCharge > 0 && <Row label="Service Charge" value={formatCurrency(serviceCharge)} />}
        {vat > 0 && <Row label="VAT" value={formatCurrency(vat)} />}
        <div className="flex justify-between font-theme-display text-4xl tracking-wider text-theme-accent pt-3 border-t border-theme-border">
          <span>TOTAL</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-xl font-theme-body ${muted ? 'text-theme-text-muted' : 'text-theme-text'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
