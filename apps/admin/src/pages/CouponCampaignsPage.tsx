import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Trash2, X, Search, ArrowRight, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';

type CouponType = 'FLAT' | 'PERCENTAGE';
type CampaignStatus = 'DRAFT' | 'SENDING' | 'SENT';

interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  filterSummary: string | null;
  couponType: CouponType;
  couponValue: number;
  validityDays: number;
  smsTemplate: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  sentAt: string | null;
  createdBy: { id: string; name: string } | null;
}

interface CampaignDetail extends Campaign {
  coupons: Array<{
    id: string;
    code: string;
    customer: { id: string; name: string; phone: string } | null;
    expiresAt: string | null;
  }>;
}

interface SegmentCustomer {
  id: string;
  name: string;
  phone: string;
  totalSpent: number;
  totalOrders: number;
  lastVisit: string | null;
  loyaltyPoints: number;
}

interface SmsTemplate { id: string; name: string; body: string }

const STATUS_BADGE: Record<CampaignStatus, string> = {
  DRAFT: 'bg-[#FFA726]/15 text-[#FFA726] border-[#FFA726]/30',
  SENDING: 'bg-[#42A5F5]/15 text-[#42A5F5] border-[#42A5F5]/30',
  SENT: 'bg-[#4CAF50]/15 text-[#4CAF50] border-[#4CAF50]/30',
};

export default function CouponCampaignsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['marketing-campaigns'],
    queryFn: () => api.get('/marketing/campaigns'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing-campaigns'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">COUPON CAMPAIGNS</h1>
          <p className="text-xs text-[#999] mt-1">
            Pick customers by spend or visits, generate unique single-use codes, review the recipient list, then send SMS.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-[#D62B2B] text-white px-4 py-2 text-sm hover:bg-[#b51e1e]"
        >
          <Plus size={14} /> New Campaign
        </button>
      </div>

      {isLoading && <p className="text-[#999] text-sm">Loading…</p>}

      {!isLoading && campaigns.length === 0 && (
        <div className="border border-[#2A2A2A] p-8 text-center text-[#666] text-sm">
          No campaigns yet. Click "New Campaign" to get started.
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="border border-[#2A2A2A] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] bg-[#161616]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Filter</th>
                <th className="px-4 py-3 text-center">Recipients</th>
                <th className="px-4 py-3 text-center">Sent / Failed</th>
                <th className="px-4 py-3">Coupon</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-[#2A2A2A] hover:bg-[#161616]">
                  <td className="px-4 py-3 text-white">{c.name}</td>
                  <td className="px-4 py-3 text-[10px] text-[#888]">{c.filterSummary ?? '—'}</td>
                  <td className="px-4 py-3 text-center text-[#DDD9D3]">{c.recipientCount}</td>
                  <td className="px-4 py-3 text-center text-[10px]">
                    <span className="text-[#4CAF50]">{c.sentCount}</span>
                    <span className="text-[#666] mx-1">/</span>
                    <span className="text-[#FFA726]">{c.failedCount}</span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[#999]">
                    {c.couponType === 'PERCENTAGE' ? `${c.couponValue}%` : `৳${(c.couponValue / 100).toLocaleString()}`} · {c.validityDays}d
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 ${STATUS_BADGE[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[#888]">
                    {new Date(c.createdAt).toLocaleDateString()}<br/>
                    by {c.createdBy?.name ?? 'system'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setReviewId(c.id)}
                      className="text-[#999] hover:text-[#4CAF50] text-xs uppercase tracking-widest mr-2"
                    >
                      {c.status === 'DRAFT' ? 'Review & Send' : 'View'}
                    </button>
                    {c.status === 'DRAFT' && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete draft "${c.name}" and its ${c.recipientCount} un-sent codes?`)) {
                            removeMut.mutate(c.id);
                          }
                        }}
                        className="text-[#999] hover:text-[#D62B2B]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateCampaignDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setReviewId(id); }} />}
      {reviewId && <ReviewDialog id={reviewId} onClose={() => setReviewId(null)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Create dialog                                                */
/* ─────────────────────────────────────────────────────────── */

function CreateCampaignDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'filter' | 'coupon'>('filter');
  const [name, setName] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [minVisits, setMinVisits] = useState('');
  const [maxLastVisitDays, setMaxLastVisitDays] = useState('');
  const [couponType, setCouponType] = useState<CouponType>('PERCENTAGE');
  const [couponValue, setCouponValue] = useState('10');
  const [validityDays, setValidityDays] = useState('30');
  const [smsTemplate, setSmsTemplate] = useState(
    'Hi {{name}}, here is your coupon for {{brand}}: {{coupon_code}} — {{coupon_value}} off. Valid until {{coupon_expires}}.',
  );
  const [error, setError] = useState<string | null>(null);

  const filterParams = useMemo(() => ({
    minSpent: Number(minSpent) || undefined,
    minVisits: Number(minVisits) || undefined,
    maxLastVisitDays: Number(maxLastVisitDays) || undefined,
  }), [minSpent, minVisits, maxLastVisitDays]);

  const recipientQs = new URLSearchParams();
  if (filterParams.minSpent) recipientQs.set('minSpent', String(filterParams.minSpent));
  if (filterParams.minVisits) recipientQs.set('minVisits', String(filterParams.minVisits));
  if (filterParams.maxLastVisitDays) recipientQs.set('maxLastVisitDays', String(filterParams.maxLastVisitDays));

  const { data: recipients = [], isFetching } = useQuery<SegmentCustomer[]>({
    queryKey: ['marketing-segment', recipientQs.toString()],
    queryFn: () => api.get(`/marketing/customers/segment?${recipientQs.toString()}`),
  });

  const { data: templates = [] } = useQuery<SmsTemplate[]>({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms/templates'),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post<Campaign>('/marketing/campaigns', {
        name: name.trim(),
        couponType,
        couponValue: Number(couponValue),
        validityDays: Number(validityDays),
        smsTemplate,
        ...filterParams,
      }),
    onSuccess: (campaign) => {
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      onCreated(campaign.id);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-3xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <div>
            <h2 className="text-lg font-bold text-white">New Coupon Campaign</h2>
            <p className="text-[10px] text-[#666] uppercase tracking-widest mt-1">
              Step {step === 'filter' ? '1' : '2'} of 2 — {step === 'filter' ? 'Filter recipients' : 'Coupon + SMS'}
            </p>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>

        <div className="overflow-y-auto p-5 flex-1 space-y-5">
          {step === 'filter' && (
            <>
              <Field label="Campaign name *">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. May VIP Push"
                  className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm focus:outline-none focus:border-[#D62B2B]"
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Min spend (৳)">
                  <input type="number" min={0} value={minSpent} onChange={(e) => setMinSpent(e.target.value)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
                </Field>
                <Field label="Min visits">
                  <input type="number" min={0} value={minVisits} onChange={(e) => setMinVisits(e.target.value)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
                </Field>
                <Field label="Visited within (days)">
                  <input type="number" min={0} value={maxLastVisitDays} onChange={(e) => setMaxLastVisitDays(e.target.value)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
                </Field>
              </div>
              <div className="border border-[#2A2A2A] p-3">
                <p className="text-[10px] uppercase tracking-widest text-[#888] mb-2">
                  Matching customers: <span className="text-white">{isFetching ? '…' : recipients.length}</span>
                </p>
                <div className="max-h-48 overflow-y-auto text-xs space-y-1">
                  {recipients.slice(0, 50).map((c) => (
                    <div key={c.id} className="flex justify-between text-[#999]">
                      <span>{c.name} ({c.phone})</span>
                      <span>৳{(Number(c.totalSpent) / 100).toLocaleString()} · {c.totalOrders} orders</span>
                    </div>
                  ))}
                  {recipients.length > 50 && <p className="text-[#666] italic mt-1">… and {recipients.length - 50} more</p>}
                </div>
              </div>
            </>
          )}

          {step === 'coupon' && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Coupon type">
                  <select value={couponType} onChange={(e) => setCouponType(e.target.value as CouponType)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm">
                    <option value="PERCENTAGE">% off</option>
                    <option value="FLAT">Flat ৳ off</option>
                  </select>
                </Field>
                <Field label={couponType === 'PERCENTAGE' ? 'Value (%)' : 'Value (৳)'}>
                  <input type="number" min={1} value={couponValue} onChange={(e) => setCouponValue(e.target.value)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
                </Field>
                <Field label="Validity (days)">
                  <input type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(e.target.value)}
                    className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
                </Field>
              </div>
              <Field label="SMS template">
                <select
                  value=""
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) setSmsTemplate(tpl.body);
                  }}
                  className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm mb-2"
                >
                  <option value="">— Pick a saved template (or edit below) —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <textarea
                  value={smsTemplate}
                  onChange={(e) => setSmsTemplate(e.target.value)}
                  rows={4}
                  className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#D62B2B]"
                />
                <p className="text-[10px] text-[#666] mt-1">
                  Variables: <code className="text-[#999]">{`{{name}}`}</code> · <code className="text-[#999]">{`{{brand}}`}</code> · <code className="text-[#999]">{`{{coupon_code}}`}</code> · <code className="text-[#999]">{`{{coupon_value}}`}</code> · <code className="text-[#999]">{`{{coupon_expires}}`}</code>
                </p>
              </Field>
            </>
          )}

          {error && <p className="text-[#ff6b6b] text-xs">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-2 p-4 border-t border-[#2A2A2A]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">Cancel</button>
          <div className="flex gap-2">
            {step === 'coupon' && (
              <button onClick={() => setStep('filter')} className="flex items-center gap-1 px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">
                <ArrowLeft size={12} /> Back
              </button>
            )}
            {step === 'filter' && (
              <button
                onClick={() => {
                  if (!name.trim()) { setError('Campaign name is required'); return; }
                  if (recipients.length === 0) { setError('No customers match this filter'); return; }
                  setError(null);
                  setStep('coupon');
                }}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e]"
              >
                Next <ArrowRight size={12} />
              </button>
            )}
            {step === 'coupon' && (
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50"
              >
                {createMut.isPending ? 'Generating…' : 'Generate codes'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </Backdrop>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Review + Send dialog                                          */
/* ─────────────────────────────────────────────────────────── */

function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: detail, isLoading } = useQuery<CampaignDetail>({
    queryKey: ['marketing-campaign', id],
    queryFn: () => api.get(`/marketing/campaigns/${id}`),
  });

  const sendMut = useMutation({
    mutationFn: () => api.post(`/marketing/campaigns/${id}/send`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-campaign', id] });
    },
  });

  const filtered = useMemo(() => {
    if (!detail) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return detail.coupons;
    return detail.coupons.filter((c) =>
      (c.customer?.name ?? '').toLowerCase().includes(needle) ||
      (c.customer?.phone ?? '').toLowerCase().includes(needle) ||
      c.code.toLowerCase().includes(needle),
    );
  }, [detail, search]);

  if (isLoading || !detail) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-[#0d0d0d] border border-[#2A2A2A] p-8" onClick={(e) => e.stopPropagation()}>
          <p className="text-[#999]">Loading…</p>
        </div>
      </Backdrop>
    );
  }

  const isDraft = detail.status === 'DRAFT';

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0d0d0d] border border-[#2A2A2A] w-full max-w-3xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
          <div>
            <h2 className="text-lg font-bold text-white">{detail.name}</h2>
            <p className="text-[10px] text-[#888] mt-1">
              {detail.recipientCount} recipients · {detail.couponType === 'PERCENTAGE' ? `${detail.couponValue}%` : `৳${(detail.couponValue / 100).toLocaleString()}`} · {detail.validityDays}d validity ·
              <span className={`ml-2 ${STATUS_BADGE[detail.status]} px-2 py-0.5`}>{detail.status}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>

        <div className="p-4 border-b border-[#2A2A2A]">
          <p className="text-[10px] uppercase tracking-widest text-[#888] mb-1">SMS preview</p>
          <p className="text-xs text-[#DDD9D3] font-mono bg-[#161616] border border-[#2A2A2A] p-3 whitespace-pre-wrap">{detail.smsTemplate}</p>
        </div>

        <div className="p-4 border-b border-[#2A2A2A] flex items-center gap-2">
          <Search size={12} className="text-[#666]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter recipients / codes…"
            className="flex-1 bg-transparent text-white text-sm focus:outline-none"
          />
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#0d0d0d]">
              <tr className="text-left text-[10px] uppercase tracking-widest text-[#888] border-b border-[#2A2A2A]">
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Coupon code</th>
                <th className="px-4 py-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-[#2A2A2A]">
                  <td className="px-4 py-2 text-white">{c.customer?.name ?? '(unknown)'}</td>
                  <td className="px-4 py-2 text-[#999]">{c.customer?.phone ?? '—'}</td>
                  <td className="px-4 py-2 text-[#4CAF50] font-mono">{c.code}</td>
                  <td className="px-4 py-2 text-[#888] text-xs">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex justify-between items-center p-4 border-t border-[#2A2A2A]">
          <p className="text-xs text-[#888]">
            {detail.status === 'SENT' ? `Sent ${detail.sentCount} · Failed ${detail.failedCount}` : `${detail.recipientCount} ready to send`}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[#999] border border-[#2A2A2A] hover:text-white">Close</button>
            {isDraft && (
              <button
                onClick={() => {
                  if (confirm(`Send SMS to all ${detail.recipientCount} recipients now?`)) sendMut.mutate();
                }}
                disabled={sendMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-[#D62B2B] text-white hover:bg-[#b51e1e] disabled:opacity-50"
              >
                <Send size={12} /> {sendMut.isPending ? 'Sending…' : 'Send all'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </Backdrop>
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
