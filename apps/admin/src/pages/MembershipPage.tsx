import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';

import type { MenuCategory, MenuItem, MembershipCard, MembershipCardState, MembershipPlan, MembershipPlanRuleInput } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

const STATE_LABEL: Record<MembershipCardState, string> = { IN_STOCK: 'In stock', ACTIVE: 'Active', EXPIRED: 'Expired', BLOCKED: 'Blocked' };
const STATE_COLOR: Record<MembershipCardState, string> = {
  IN_STOCK: 'text-[#999]', ACTIVE: 'text-[#4CAF50]', EXPIRED: 'text-[#FFA726]', BLOCKED: 'text-[#D62B2B]',
};
const INPUT = 'bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B] placeholder:text-[#555]';
const LABEL = 'text-[#666] text-xs font-body font-medium tracking-widest uppercase block mb-1';
const PRIMARY = 'bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-40';
const GHOST = 'border border-[#2A2A2A] text-[#999] hover:border-[#555] hover:text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-40';

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const groupDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const friendly = (e: unknown) => (e as Error).message.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());

/** Serial, number as printed, and the digits the QR must contain. */
function downloadCsv(cards: MembershipCard[]) {
  const rows = [['serial', 'card_number', 'qr_text'], ...cards.map((c) => [String(c.serial).padStart(4, '0'), c.formattedNumber, c.number])];
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `eatro-membership-cards-${cards[0]?.serial ?? 0}-${cards[cards.length - 1]?.serial ?? 0}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const CSV_NOTE = 'Send this file to the print shop as it is. Opening and saving it in Excel rounds off 16-digit numbers and spoils the QR column.';

// ─── Small dialog shell ──────────────────────────────────────────────────────

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-white tracking-widest">{title}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function GenerateDialog({ plan, onClose }: { plan: MembershipPlan; onClose: () => void }) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState('150');
  const [batchLabel, setBatchLabel] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post<MembershipCard[]>('/membership/cards/generate', { planId: plan.id, quantity: parseInt(quantity, 10), batchLabel: batchLabel || undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['membership-cards'] }),
  });
  const created = mutation.data;
  return (
    <Dialog title="GENERATE CARDS" onClose={onClose}>
      {created ? (
        <>
          <p className="text-white font-body text-sm">
            {created.length} cards created, serial {created[0].serial} to {created[created.length - 1].serial}.
          </p>
          <p className="text-[#999] font-body text-xs">{CSV_NOTE}</p>
          <div className="flex gap-3">
            <button onClick={onClose} className={`flex-1 ${GHOST}`}>Close</button>
            <button onClick={() => downloadCsv(created)} className={`flex-1 ${PRIMARY}`}>Download CSV</button>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={LABEL}>How many cards</label>
            <input type="number" min={1} max={500} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Batch label (optional)</label>
            <input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} placeholder="e.g. First print, Nov 2026" className={`w-full ${INPUT}`} />
          </div>
          <p className="text-[#666] font-body text-xs">Plan: {plan.name}, {plan.discountPercent}% off, valid {plan.validityMonths} months from hand-over.</p>
          {mutation.isError && <p className="text-[#F03535] text-xs font-body">{friendly(mutation.error)}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className={`flex-1 ${GHOST}`}>Cancel</button>
            <button onClick={() => mutation.mutate()} disabled={!(parseInt(quantity, 10) > 0) || mutation.isPending} className={`flex-1 ${PRIMARY}`}>
              {mutation.isPending ? 'Creating…' : 'Generate'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function GiveDialog({ card, onClose }: { card: MembershipCard; onClose: () => void }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post('/membership/cards/activate', { number: card.number, phone, name: name || undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['membership-cards'] }); onClose(); },
  });
  return (
    <Dialog title="GIVE CARD" onClose={onClose}>
      <p className="text-[#999] font-body text-sm font-mono">{card.formattedNumber}</p>
      <div>
        <label className={LABEL}>Customer phone *</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus className={`w-full ${INPUT}`} />
      </div>
      <div>
        <label className={LABEL}>Customer name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`w-full ${INPUT}`} />
      </div>
      {mutation.isError && <p className="text-[#F03535] text-xs font-body">{friendly(mutation.error)}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className={`flex-1 ${GHOST}`}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!phone.trim() || mutation.isPending} className={`flex-1 ${PRIMARY}`}>Give card</button>
      </div>
    </Dialog>
  );
}

function ReplaceDialog({ card, onClose }: { card: MembershipCard; onClose: () => void }) {
  const qc = useQueryClient();
  const [number, setNumber] = useState('');
  const digits = number.replace(/\s/g, '');
  const mutation = useMutation({
    mutationFn: () => api.post(`/membership/cards/${card.id}/replace`, { number: digits }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['membership-cards'] }); onClose(); },
  });
  return (
    <Dialog title="REPLACE CARD" onClose={onClose}>
      <p className="text-[#999] font-body text-sm">
        {card.customer?.name} moves from <span className="font-mono">{card.formattedNumber}</span> to a new card, with the same expiry date. The old card is blocked.
      </p>
      <div>
        <label className={LABEL}>New card number</label>
        <input value={number} onChange={(e) => setNumber(groupDigits(e.target.value))} autoFocus placeholder="3287 0000 0000 0000" className={`w-full font-mono ${INPUT}`} />
      </div>
      {mutation.isError && <p className="text-[#F03535] text-xs font-body">{friendly(mutation.error)}</p>}
      <div className="flex gap-3">
        <button onClick={onClose} className={`flex-1 ${GHOST}`}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={digits.length !== 16 || mutation.isPending} className={`flex-1 ${PRIMARY}`}>Replace</button>
      </div>
    </Dialog>
  );
}

// ─── Cards tab ───────────────────────────────────────────────────────────────

function CardsTab({ plan }: { plan: MembershipPlan | undefined }) {
  const qc = useQueryClient();
  const { data: cards = [], isLoading } = useQuery<MembershipCard[]>({ queryKey: ['membership-cards'], queryFn: () => api.get('/membership/cards') });
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<MembershipCardState | ''>('');
  const [generating, setGenerating] = useState(false);
  const [giving, setGiving] = useState<MembershipCard | null>(null);
  const [replacing, setReplacing] = useState<MembershipCard | null>(null);

  const action = useMutation({
    mutationFn: ({ id, verb, reason }: { id: string; verb: 'block' | 'unblock' | 'renew'; reason?: string }) => api.post(`/membership/cards/${id}/${verb}`, { reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['membership-cards'] }),
  });

  const counts = useMemo(() => {
    const c: Record<MembershipCardState, number> = { IN_STOCK: 0, ACTIVE: 0, EXPIRED: 0, BLOCKED: 0 };
    for (const card of cards) c[card.state]++;
    return c;
  }, [cards]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return cards.filter((c) => {
      if (stateFilter && c.state !== stateFilter) return false;
      if (!q) return true;
      return (
        (digits.length > 0 && (c.number.includes(digits) || String(c.serial) === digits || (c.customer?.phone ?? '').includes(digits))) ||
        (c.customer?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [cards, search, stateFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {(Object.keys(STATE_LABEL) as MembershipCardState[]).map((s) => (
          <button key={s} onClick={() => setStateFilter(stateFilter === s ? '' : s)}
            className={`bg-[#161616] border p-4 text-left ${stateFilter === s ? 'border-[#D62B2B]' : 'border-[#2A2A2A]'}`}>
            <p className={`font-body text-xs tracking-widest uppercase mb-1 ${STATE_COLOR[s]}`}>{STATE_LABEL[s]}</p>
            <p className="font-display text-white text-3xl">{counts[s]}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search card number, serial, name or phone" className={`flex-1 ${INPUT}`} />
        <button onClick={() => downloadCsv(shown)} disabled={shown.length === 0} title={CSV_NOTE} className={GHOST}>CSV for print shop</button>
        <button onClick={() => setGenerating(true)} disabled={!plan} title={plan ? undefined : 'Create the plan first'} className={`flex items-center gap-1.5 ${PRIMARY}`}>
          <Plus size={14} /> Generate cards
        </button>
      </div>
      {action.isError && <p className="text-[#F03535] text-xs font-body">{friendly(action.error)}</p>}

      <div className="bg-[#161616] border border-[#2A2A2A] overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              {['#', 'Card number', 'Status', 'Member', 'Expires', 'Given by', 'Visits', 'Discount given', ''].map((h) => (
                <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666]">Loading…</td></tr>}
            {!isLoading && shown.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-[#666]">No cards found.</td></tr>}
            {shown.map((c) => (
              <tr key={c.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-4 py-2.5 text-[#666] text-xs">{String(c.serial).padStart(4, '0')}</td>
                <td className="px-4 py-2.5 text-white font-mono text-xs whitespace-nowrap">{c.formattedNumber}</td>
                <td className={`px-4 py-2.5 text-xs font-medium ${STATE_COLOR[c.state]}`}>
                  {STATE_LABEL[c.state]}
                  {c.state === 'BLOCKED' && c.blockedReason && <span className="block text-[10px] text-[#666] font-normal">{c.blockedReason}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {c.customer ? (
                    <>
                      <p className="text-white text-xs">{c.customer.name}</p>
                      <p className="text-[#666] text-[11px]">{c.customer.phone}</p>
                    </>
                  ) : <span className="text-[#555]">—</span>}
                </td>
                <td className="px-4 py-2.5 text-[#999] text-xs whitespace-nowrap">{fmtDay(c.expiresAt)}</td>
                <td className="px-4 py-2.5 text-[#999] text-xs">{c.activatedByName ?? '—'}</td>
                <td className="px-4 py-2.5 text-[#999] text-xs">{c.visits}</td>
                <td className="px-4 py-2.5 text-[#999] text-xs whitespace-nowrap">{c.totalDiscount > 0 ? formatCurrency(c.totalDiscount) : '—'}</td>
                <td className="px-4 py-2.5 whitespace-nowrap space-x-3 text-xs">
                  {c.status === 'IN_STOCK' && <button onClick={() => setGiving(c)} className="text-[#4CAF50] hover:text-white">Give</button>}
                  {c.status === 'ACTIVE' && <button onClick={() => action.mutate({ id: c.id, verb: 'renew' })} className="text-[#4CAF50] hover:text-white">Renew</button>}
                  {c.status === 'ACTIVE' && <button onClick={() => setReplacing(c)} className="text-[#FFA726] hover:text-white">Replace</button>}
                  {c.status !== 'BLOCKED' && (
                    <button onClick={() => { const reason = prompt(`Block card ${c.formattedNumber}? Reason:`, 'Lost'); if (reason !== null) action.mutate({ id: c.id, verb: 'block', reason }); }}
                      className="text-[#D62B2B] hover:text-white">Block</button>
                  )}
                  {c.status === 'BLOCKED' && c.blockedReason !== 'Replaced' && <button onClick={() => action.mutate({ id: c.id, verb: 'unblock' })} className="text-[#999] hover:text-white">Unblock</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {generating && plan && <GenerateDialog plan={plan} onClose={() => setGenerating(false)} />}
      {giving && <GiveDialog card={giving} onClose={() => setGiving(null)} />}
      {replacing && <ReplaceDialog card={replacing} onClose={() => setReplacing(null)} />}
    </div>
  );
}

// ─── Plan tab ────────────────────────────────────────────────────────────────

type RuleMode = 'EXCLUDE' | 'PERCENTAGE' | 'FLAT';
interface RuleRow { key: string; menuItemId: string | null; categoryId: string | null; label: string; mode: RuleMode; value: string }
interface Target { id: string; kind: 'item' | 'category'; label: string }

function rowsFromPlan(plan: MembershipPlan): RuleRow[] {
  return plan.rules.map((r) => ({
    key: r.menuItemId ?? r.categoryId ?? r.id,
    menuItemId: r.menuItemId,
    categoryId: r.categoryId,
    label: r.menuItem?.name ?? r.category?.name ?? '',
    mode: r.kind === 'EXCLUDE' ? 'EXCLUDE' : (r.type as RuleMode),
    value: r.kind === 'EXCLUDE' ? '' : String(r.type === 'FLAT' ? Number(r.value) / 100 : Number(r.value)),
  }));
}

function PlanForm({ plan }: { plan?: MembershipPlan }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan?.name ?? 'Eatro Member');
  const [percent, setPercent] = useState(String(plan?.discountPercent ?? 10));
  const [months, setMonths] = useState(String(plan?.validityMonths ?? 12));
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [rows, setRows] = useState<RuleRow[]>(() => (plan ? rowsFromPlan(plan) : []));
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: categories = [] } = useQuery<MenuCategory[]>({ queryKey: ['categories'], queryFn: () => api.get('/menu/categories') });
  const { data: items = [] } = useQuery<MenuItem[]>({ queryKey: ['menu-for-membership'], queryFn: () => api.get('/menu') });

  const targets = useMemo<Target[]>(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return [
      ...categories.map((c) => ({ id: c.id, kind: 'category' as const, label: c.parentId ? `${byId.get(c.parentId)?.name ?? ''} › ${c.name}` : c.name })),
      // Options are covered by a rule on their dish.
      ...items.filter((m) => !m.variantParentId && !m.isCustom && !m.deletedAt).map((m) => ({ id: m.id, kind: 'item' as const, label: m.name })),
    ];
  }, [categories, items]);

  const q = query.trim().toLowerCase();
  const matches = q ? targets.filter((t) => t.label.toLowerCase().includes(q) && !rows.some((r) => r.key === t.id)).slice(0, 8) : [];

  const addRow = (t: Target) => {
    setRows((p) => [...p, { key: t.id, menuItemId: t.kind === 'item' ? t.id : null, categoryId: t.kind === 'category' ? t.id : null, label: t.label, mode: 'EXCLUDE', value: '' }]);
    setQuery('');
    setSaved(false);
  };
  const update = (key: string, patch: Partial<RuleRow>) => { setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r))); setSaved(false); };

  const save = useMutation({
    mutationFn: async () => {
      const fields = { name, discountPercent: parseFloat(percent), validityMonths: parseInt(months, 10) };
      const target = plan
        ? await api.patch<MembershipPlan>(`/membership/plans/${plan.id}`, { ...fields, isActive })
        : await api.post<MembershipPlan>('/membership/plans', fields);
      const rules: MembershipPlanRuleInput[] = rows.map((r) => ({
        menuItemId: r.menuItemId,
        categoryId: r.categoryId,
        kind: r.mode === 'EXCLUDE' ? 'EXCLUDE' : 'SPECIAL',
        type: r.mode === 'EXCLUDE' ? null : r.mode,
        value: r.mode === 'EXCLUDE' ? null : r.mode === 'FLAT' ? Math.round(parseFloat(r.value) * 100) : parseFloat(r.value),
      }));
      return api.put(`/membership/plans/${target.id}/rules`, { rules });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['membership-plans'] }); setSaved(true); },
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-[#161616] border border-[#2A2A2A] p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>Plan name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`w-full ${INPUT}`} />
            <p className="text-[#555] text-[10px] font-body mt-1">Printed on the receipt.</p>
          </div>
          <div>
            <label className={LABEL}>Discount %</label>
            <input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Valid (months)</label>
            <input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} className={`w-full ${INPUT}`} />
          </div>
        </div>
        {plan && (
          <label className="flex items-center gap-2 text-sm font-body text-[#999]">
            <input type="checkbox" checked={isActive} onChange={(e) => { setIsActive(e.target.checked); setSaved(false); }} /> Plan is on (off = no card gives a discount)
          </label>
        )}
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] p-5 space-y-3">
        <div>
          <p className="text-white font-body text-sm font-medium">Exclusions and member-only rates</p>
          <p className="text-[#666] font-body text-xs mt-0.5">Everything gets the discount above unless it is listed here. A rule on a dish covers all its options; a rule on a category covers everything in it.</p>
        </div>
        <div className="relative">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a menu item or category to add" className={`w-full ${INPUT}`} />
          {matches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-[#0D0D0D] border border-[#2A2A2A] max-h-64 overflow-auto">
              {matches.map((t) => (
                <button key={t.id} onClick={() => addRow(t)} className="w-full text-left px-3 py-2 text-sm font-body text-white hover:bg-[#1F1F1F] flex justify-between">
                  <span>{t.label}</span>
                  <span className="text-[10px] uppercase tracking-widest text-[#666]">{t.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0 && <p className="text-[#555] font-body text-xs">Nothing excluded yet.</p>}
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <span className="flex-1 text-sm font-body text-white truncate">{r.label}</span>
            <select value={r.mode} onChange={(e) => update(r.key, { mode: e.target.value as RuleMode })} className={INPUT}>
              <option value="EXCLUDE">No discount</option>
              <option value="PERCENTAGE">Member rate %</option>
              <option value="FLAT">Member ৳ off each</option>
            </select>
            {r.mode !== 'EXCLUDE' ? (
              <input type="number" min={0} value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} placeholder={r.mode === 'FLAT' ? '৳' : '%'} className={`w-20 ${INPUT}`} />
            ) : <span className="w-20" />}
            <button onClick={() => { setRows((p) => p.filter((x) => x.key !== r.key)); setSaved(false); }} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {save.isError && <p className="text-[#F03535] text-xs font-body">{friendly(save.error)}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending || rows.some((r) => r.mode !== 'EXCLUDE' && !(parseFloat(r.value) > 0))}
          className={PRIMARY}
        >
          {save.isPending ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}
        </button>
        {saved && <span className="text-[#4CAF50] font-body text-xs">Saved</span>}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MembershipPage() {
  const [tab, setTab] = useState<'cards' | 'plan'>('cards');
  const { data: plans = [], isLoading } = useQuery<MembershipPlan[]>({
    queryKey: ['membership-plans'],
    queryFn: () => api.get('/membership/plans'),
    select: (d) => d.map((p) => ({ ...p, discountPercent: Number(p.discountPercent), rules: p.rules.map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) })) })),
  });
  const plan = plans[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Marketing</p>
        <h1 className="font-display text-4xl text-white tracking-wide">MEMBERSHIP CARDS</h1>
      </div>
      <div className="flex border-b border-[#2A2A2A]">
        {(['cards', 'plan'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-xs font-body font-medium tracking-widest uppercase border-b-2 transition-colors ${tab === t ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666] hover:text-[#999]'}`}>
            {t === 'cards' ? 'Cards' : 'Plan & Rules'}
          </button>
        ))}
      </div>
      {tab === 'cards' && <CardsTab plan={plan} />}
      {tab === 'plan' && !isLoading && <PlanForm key={plan?.id ?? 'new'} plan={plan} />}
    </div>
  );
}
