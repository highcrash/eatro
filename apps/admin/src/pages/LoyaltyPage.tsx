import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Send, X } from 'lucide-react';
import { api } from '../lib/api';

interface LoyaltyCustomer {
  id: string;
  name: string;
  phone: string;
  loyaltyPoints: number;
  loyaltyExpiresAt: string | null;
  totalSpent: number;
  totalOrders: number;
  lastVisit: string | null;
}

interface LoyaltyTransaction {
  id: string;
  type: 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'ADJUSTMENT';
  points: number;
  description: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; totalAmount: number } | null;
}

interface SmsTemplate { id: string; name: string; body: string }

export default function LoyaltyPage() {
  const qc = useQueryClient();
  const [drawerCustomerId, setDrawerCustomerId] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<LoyaltyCustomer | null>(null);
  const [blastOpen, setBlastOpen] = useState(false);

  const { data: customers = [], isLoading } = useQuery<LoyaltyCustomer[]>({
    queryKey: ['loyalty-customers'],
    queryFn: () => api.get('/loyalty/customers'),
  });

  const expireMut = useMutation({
    mutationFn: () => api.post('/loyalty/expire-now', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loyalty-customers'] }),
  });

  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    const totalPoints = customers.reduce((s, c) => s + c.loyaltyPoints, 0);
    return { totalCustomers, totalPoints };
  }, [customers]);

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">LOYALTY</h1>
          <p className="text-xs text-[#999] mt-1">
            Customer point balances + ledger. Daily expiry sweep runs at 03:00 (manual trigger available).
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setBlastOpen(true)}
          className="flex items-center gap-2 bg-[#161616] border border-[#2A2A2A] text-[#DDD9D3] px-4 py-2 text-sm hover:border-[#444]"
        >
          <Send size={14} /> Send Milestone SMS
        </button>
        <button
          onClick={() => expireMut.mutate()}
          disabled={expireMut.isPending}
          className="flex items-center gap-2 bg-[#161616] border border-[#2A2A2A] text-[#DDD9D3] px-4 py-2 text-sm hover:border-[#444] disabled:opacity-50"
          title="Manually run the expiry sweep now"
        >
          <RefreshCw size={14} className={expireMut.isPending ? 'animate-spin' : ''} /> Run Expiry Sweep
        </button>
      </div>

      {expireMut.data != null && (
        <div className="border border-[#FFA726]/30 bg-[#FFA726]/10 text-[#FFA726] px-4 py-2 text-xs">
          Expiry sweep cleared {(expireMut.data as { expired: number }).expired} customer balance(s).
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Tile label="Customers with points" value={String(stats.totalCustomers)} />
        <Tile label="Total points outstanding" value={stats.totalPoints.toLocaleString()} sub="At ৳1/pt redemption" />
      </div>

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {!isLoading && customers.length === 0 && (
        <div className="border border-[#2A2A2A] p-8 text-center text-[#666] text-sm">
          No customers have earned points yet. Enable loyalty in Settings → Marketing.
        </div>
      )}

      {customers.length > 0 && (
        <div className="border border-[#2A2A2A] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] bg-[#161616]">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3 text-right">Total Spent</th>
                <th className="px-4 py-3 text-center">Visits</th>
                <th className="px-4 py-3">Last Visit</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-[#2A2A2A] hover:bg-[#161616]">
                  <td className="px-4 py-3 text-white">{c.name}</td>
                  <td className="px-4 py-3 text-[#999] font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-3 text-right text-[#4CAF50] font-medium">{c.loyaltyPoints.toLocaleString()}</td>
                  <td className="px-4 py-3 text-[10px] text-[#888]">
                    {c.loyaltyExpiresAt ? new Date(c.loyaltyExpiresAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-[#DDD9D3]">৳{(Number(c.totalSpent) / 100).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center text-[#999]">{c.totalOrders}</td>
                  <td className="px-4 py-3 text-[10px] text-[#888]">
                    {c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setDrawerCustomerId(c.id)} className="text-[#999] hover:text-[#4CAF50] text-xs uppercase tracking-widest mr-2">
                      Ledger
                    </button>
                    <button onClick={() => setAdjustFor(c)} className="text-[#999] hover:text-[#FFA726] text-xs uppercase tracking-widest">
                      Adjust
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerCustomerId && (
        <LedgerDrawer
          customerId={drawerCustomerId}
          customer={customers.find((c) => c.id === drawerCustomerId) ?? null}
          onClose={() => setDrawerCustomerId(null)}
        />
      )}

      {adjustFor && <AdjustDialog customer={adjustFor} onClose={() => setAdjustFor(null)} />}

      {blastOpen && <BlastDialog onClose={() => setBlastOpen(false)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */

function LedgerDrawer({ customerId, customer, onClose }: { customerId: string; customer: LoyaltyCustomer | null; onClose: () => void }) {
  const { data: ledger = [], isLoading } = useQuery<LoyaltyTransaction[]>({
    queryKey: ['loyalty-transactions', customerId],
    queryFn: () => api.get(`/loyalty/transactions/${customerId}`),
  });

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-2xl max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <div>
            <h2 className="text-lg font-bold text-white">{customer?.name ?? 'Customer'} — ledger</h2>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mt-1">
              Balance {customer?.loyaltyPoints.toLocaleString() ?? 0} pt · {customer?.phone}
            </p>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>
        <div className="overflow-y-auto p-4 flex-1">
          {isLoading && <p className="text-[#999] text-sm">Loading…</p>}
          {!isLoading && ledger.length === 0 && <p className="text-[#666] text-sm">No transactions yet.</p>}
          <table className="w-full text-sm">
            <tbody>
              {ledger.map((t) => (
                <tr key={t.id} className="border-b border-[#2A2A2A]">
                  <td className="py-2 pr-3 text-[10px] text-[#666] whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 ${
                      t.type === 'EARNED' ? 'text-[#4CAF50] bg-[#4CAF50]/10' :
                      t.type === 'REDEEMED' ? 'text-[#42A5F5] bg-[#42A5F5]/10' :
                      t.type === 'EXPIRED' ? 'text-[#FFA726] bg-[#FFA726]/10' :
                      'text-[#DDD9D3] bg-[#DDD9D3]/10'
                    }`}>{t.type}</span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    <span className={t.points >= 0 ? 'text-[#4CAF50]' : 'text-[#FFA726]'}>
                      {t.points >= 0 ? '+' : ''}{t.points}
                    </span>
                  </td>
                  <td className="py-2 text-[#999] text-xs">{t.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─────────────────────────────────────────────────────────── */

function AdjustDialog({ customer, onClose }: { customer: LoyaltyCustomer; onClose: () => void }) {
  const qc = useQueryClient();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => api.post('/loyalty/adjust', {
      customerId: customer.id,
      points: Number(points),
      reason: reason.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loyalty-customers'] });
      qc.invalidateQueries({ queryKey: ['loyalty-transactions', customer.id] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-md">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-bold text-white">Adjust — {customer.name}</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>
        <div className="p-5 space-y-4">
          <p className="text-xs text-[#888]">Current balance: <span className="text-white">{customer.loyaltyPoints} pt</span></p>
          <Field label="Points (positive credits, negative debits) *">
            <input type="number" value={points} onChange={(e) => setPoints(e.target.value)}
              className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
          </Field>
          <Field label="Reason *">
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Compensation for delayed order"
              className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
          </Field>
          {error && <p className="text-[#ff6b6b] text-xs">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 p-4 border-t border-[#2A2A2A]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending || !points || !reason.trim()}
            className="px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50">
            {mut.isPending ? 'Saving…' : 'Apply'}
          </button>
        </footer>
      </div>
    </Backdrop>
  );
}

/* ─────────────────────────────────────────────────────────── */

function BlastDialog({ onClose }: { onClose: () => void }) {
  const [minLoyaltyPoints, setMinLoyaltyPoints] = useState('1000');
  const [smsTemplate, setSmsTemplate] = useState(
    'Hi {{name}}, you have {{points_balance}} loyalty points at {{brand}}. Visit us to redeem on QR ordering.',
  );
  const [result, setResult] = useState<{ recipientCount: number; sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: templates = [] } = useQuery<SmsTemplate[]>({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms/templates'),
  });

  const sendMut = useMutation({
    mutationFn: () => api.post<{ recipientCount: number; sent: number; failed: number }>('/marketing/loyalty-blast', {
      minLoyaltyPoints: Number(minLoyaltyPoints) || undefined,
      smsTemplate,
    }),
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-2xl">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-bold text-white">Send Loyalty Milestone SMS</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>
        <div className="p-5 space-y-4">
          <Field label="Min loyalty points">
            <input type="number" min={0} value={minLoyaltyPoints} onChange={(e) => setMinLoyaltyPoints(e.target.value)}
              className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
          </Field>
          <Field label="SMS template">
            <select
              value=""
              onChange={(e) => {
                const tpl = templates.find((t) => t.id === e.target.value);
                if (tpl) setSmsTemplate(tpl.body);
              }}
              className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm mb-2"
            >
              <option value="">— Pick a saved template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <textarea value={smsTemplate} onChange={(e) => setSmsTemplate(e.target.value)} rows={4}
              className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-mono" />
            <p className="text-[10px] text-[#666] mt-1">
              Variables: <code className="text-[#999]">{`{{name}}`}</code> · <code className="text-[#999]">{`{{brand}}`}</code> · <code className="text-[#999]">{`{{points_balance}}`}</code>
            </p>
          </Field>
          {result && (
            <div className="border border-[#4CAF50]/30 bg-[#4CAF50]/10 text-[#4CAF50] p-3 text-xs">
              Sent {result.sent} of {result.recipientCount} ({result.failed} failed).
            </div>
          )}
          {error && <p className="text-[#ff6b6b] text-xs">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 p-4 border-t border-[#2A2A2A]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">Close</button>
          <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending || !smsTemplate.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50">
            <Send size={12} /> {sendMut.isPending ? 'Sending…' : 'Send SMS'}
          </button>
        </footer>
      </div>
    </Backdrop>
  );
}

/* ─────────────────────────────────────────────────────────── */

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#161616] border border-[#2A2A2A] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-[#888]">{label}</p>
      <p className="text-2xl font-bold mt-1 text-white">{value}</p>
      {sub && <p className="text-[10px] text-[#666] mt-1">{sub}</p>}
    </div>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-[#888] mb-1 block">{label}</span>
      {children}
    </label>
  );
}

void Plus;
