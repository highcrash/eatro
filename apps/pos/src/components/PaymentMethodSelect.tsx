import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Payment-method dropdown wired to the SAME /payment-methods endpoint
 * the order PaymentModal uses. Sending a configured PaymentOption.code
 * (rather than a legacy hard-coded enum like "BKASH") is what
 * account.service.updateAccountForPayment looks up against, so an
 * expense / supplier payment / payroll payment paid via bKash actually
 * posts to the bKash Account row and shows up in its statement.
 *
 * Originally lived inline in PosFinancePage; promoted to a shared
 * component so PosPurchasingPage's "Pay Supplier" tab and any future
 * payment surface can re-use the same wiring without duplicating the
 * fix.
 */
type PMOption = { code: string; name: string; isActive: boolean; isDefault: boolean };
type PMCategory = { id: string; code: string; name: string; isActive: boolean; options: PMOption[] };

export function PaymentMethodSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { data: categories = [] } = useQuery<PMCategory[]>({
    queryKey: ['payment-methods'],
    queryFn: () => api.get('/payment-methods'),
    select: (d) => d.filter((c) => c.isActive && c.options.some((o) => o.isActive)),
  });
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent'}
    >
      {categories.length === 0 ? (
        <option value="CASH">Cash</option>
      ) : (
        categories.map((c) => (
          <optgroup key={c.id} label={c.name}>
            {c.options.filter((o) => o.isActive).map((o) => (
              <option key={o.code} value={o.code}>{o.name}</option>
            ))}
          </optgroup>
        ))
      )}
    </select>
  );
}
