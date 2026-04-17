import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Plus, X, Check, Trash2 } from 'lucide-react';

import type { CashierAction, PreReadyItem, ProductionOrder } from '@restora/types';
import { api } from '../lib/api';
import { useIsOnline } from '../lib/online';
import { OfflineBanner } from '../components/OfflineHint';
import { useCashierPermissions } from '../lib/permissions';
import ApprovalOtpDialog from '../components/ApprovalOtpDialog';

type Tab = 'items' | 'active';

export default function PosPreReadyPage() {
  const qc = useQueryClient();
  const { data: perms } = useCashierPermissions();
  const online = useIsOnline();

  const enabled = !!perms && perms.createPreReadyKT.enabled && perms.createPreReadyKT.approval !== 'NONE';
  const mode = perms?.createPreReadyKT.approval ?? 'AUTO';

  const [tab, setTab] = useState<Tab>('items');
  const [createFor, setCreateFor] = useState<PreReadyItem | null>(null);
  const [wasteFor, setWasteFor] = useState<ProductionOrder | null>(null);
  const [pendingAction, setPendingAction] = useState<null | { action: CashierAction; summary: string; run: (otp: string | null) => void }>(null);

  const { data: items = [] } = useQuery<PreReadyItem[]>({
    queryKey: ['pre-ready-items'],
    queryFn: () => api.get('/pre-ready/items'),
  });

  const { data: productions = [] } = useQuery<ProductionOrder[]>({
    queryKey: ['pre-ready-productions'],
    queryFn: () => api.get('/pre-ready/productions'),
    refetchInterval: 5000,
  });

  const activeProductions = useMemo(
    () => productions.filter((p) => p.status === 'PENDING' || p.status === 'APPROVED' || p.status === 'IN_PROGRESS'),
    [productions],
  );

  const guardAndRun = (action: CashierAction, summary: string, run: (otp: string | null) => void) => {
    if (!online) {
      alert('This action needs internet — reconnect to create pre-ready tickets.');
      return;
    }
    if (mode === 'AUTO' || mode === 'NONE') { run(null); return; }
    setPendingAction({ action, summary, run });
  };

  if (!enabled) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-center max-w-sm">
          <ChefHat size={36} className="text-theme-text-muted mx-auto mb-3" />
          <p className="text-sm font-semibold text-theme-text">Pre-Ready production not enabled</p>
          <p className="text-xs text-theme-text-muted mt-1">Ask your administrator to enable cashier production tickets in admin → Cashier Permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <ChefHat size={18} className="text-theme-accent" />
        <div className="h-8 w-px bg-theme-border" />
        <h1 className="text-xl font-extrabold text-theme-text">Pre-Ready Production</h1>
        <div className="flex-1" />
      </header>

      {!online && (
        <div className="px-6 pt-4 shrink-0">
          <OfflineBanner message="Pre-Ready production is disabled while offline — tickets need a live kitchen connection." />
        </div>
      )}

      <div className="px-6 pt-5 pb-4 shrink-0 flex justify-center">
        <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border">
          <button
            onClick={() => setTab('items')}
            className={`px-5 py-2 text-sm rounded-theme transition-colors ${tab === 'items' ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'}`}
          >
            Items
          </button>
          <button
            onClick={() => setTab('active')}
            className={`px-5 py-2 text-sm rounded-theme transition-colors ${tab === 'active' ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'}`}
          >
            Active Production ({activeProductions.length})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 flex justify-center">
        <div className="w-full max-w-4xl">
          {tab === 'items' && (
            <div className="bg-theme-surface rounded-theme border border-theme-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-theme-bg">
                  <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Min</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((i) => i.isActive).map((it) => {
                    const low = Number(it.minimumStock) > 0 && Number(it.currentStock) <= Number(it.minimumStock);
                    return (
                      <tr key={it.id} className="border-t border-theme-border">
                        <td className="px-4 py-3 font-semibold text-theme-text">{it.name}</td>
                        <td className={`px-4 py-3 text-right font-bold ${low ? 'text-theme-danger' : 'text-theme-text'}`}>
                          {Number(it.currentStock).toFixed(2)} {it.unit}
                        </td>
                        <td className="px-4 py-3 text-right text-theme-text-muted">
                          {Number(it.minimumStock).toFixed(2)} {it.unit}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setCreateFor(it)}
                            className="bg-theme-accent text-white text-xs font-bold px-3 py-1.5 rounded-theme hover:opacity-90 transition-opacity inline-flex items-center gap-1"
                          >
                            <Plus size={12} /> Create KT
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.filter((i) => i.isActive).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-12 text-center text-theme-text-muted text-sm">No pre-ready items configured</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'active' && (
            <div className="bg-theme-surface rounded-theme border border-theme-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-theme-bg">
                  <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-4 py-3 text-right">Quantity</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProductions.map((p) => (
                    <tr key={p.id} className="border-t border-theme-border">
                      <td className="px-4 py-3 font-semibold text-theme-text">{p.preReadyItem?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-theme-text font-bold">
                        {Number(p.quantity).toFixed(2)} {p.preReadyItem?.unit ?? ''}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-theme-warn bg-theme-warn/10 px-2 py-0.5 rounded">
                          {p.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-theme-text-muted text-xs">
                        {new Date(p.createdAt).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <CompleteBtn production={p} qc={qc} />
                          <button
                            onClick={() => setWasteFor(p)}
                            className="bg-theme-danger text-white text-xs font-bold px-3 py-1.5 rounded-theme hover:opacity-90 transition-opacity inline-flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Waste
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {activeProductions.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-theme-text-muted text-sm">No active production tickets</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createFor && (
        <CreateKTDialog
          item={createFor}
          onClose={() => setCreateFor(null)}
          onSubmit={(qty, notes) => {
            guardAndRun('createPreReadyKT', `Create KT — ${createFor.name} x${qty}`, (otp) => {
              api.post('/cashier-ops/pre-ready/create', {
                preReadyItemId: createFor.id,
                quantity: qty,
                notes: notes || undefined,
                actionOtp: otp ?? undefined,
              })
                .then(() => {
                  void qc.invalidateQueries({ queryKey: ['pre-ready-productions'] });
                  setCreateFor(null);
                  setTab('active');
                })
                .catch((e: Error) => alert(e.message));
            });
          }}
        />
      )}

      {wasteFor && (
        <WasteDialog
          production={wasteFor}
          onClose={() => setWasteFor(null)}
          onSubmit={(reason) => {
            api.post(`/pre-ready/productions/${wasteFor.id}/waste`, { reason })
              .then(() => {
                void qc.invalidateQueries({ queryKey: ['pre-ready-productions'] });
                void qc.invalidateQueries({ queryKey: ['ingredients'] });
                setWasteFor(null);
              })
              .catch((e: Error) => alert(e.message));
          }}
        />
      )}

      {pendingAction && (
        <ApprovalOtpDialog
          action={pendingAction.action}
          summary={pendingAction.summary}
          onClose={() => setPendingAction(null)}
          onApproved={(otp) => {
            const { run } = pendingAction;
            setPendingAction(null);
            run(otp);
          }}
        />
      )}
    </div>
  );
}

// ─── Complete button (with date picker for makingDate/expiryDate) ────────────

function CompleteBtn({ production, qc }: { production: ProductionOrder; qc: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [makingDate, setMakingDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  const mut = useMutation({
    mutationFn: () => api.post(`/pre-ready/productions/${production.id}/complete`, { makingDate, expiryDate }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pre-ready-productions'] });
      void qc.invalidateQueries({ queryKey: ['pre-ready-items'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      setOpen(false);
    },
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-theme-pop text-white text-xs font-bold px-3 py-1.5 rounded-theme hover:opacity-90 transition-opacity inline-flex items-center gap-1"
      >
        <Check size={12} /> Complete
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-theme-text">Complete Production</h3>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  {production.preReadyItem?.name} × {Number(production.quantity).toFixed(2)} {production.preReadyItem?.unit}
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
                <X size={14} />
              </button>
            </header>
            <div className="p-6 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Making Date</label>
                <input type="date" value={makingDate} onChange={(e) => setMakingDate(e.target.value)} className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Expiry Date</label>
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent" />
              </div>
              {mut.isError && <p className="text-xs text-theme-danger">{(mut.error as Error).message}</p>}
            </div>
            <footer className="px-6 py-4 border-t border-theme-border flex gap-3">
              <button onClick={() => setOpen(false)} className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors">Cancel</button>
              <button onClick={() => mut.mutate()} disabled={mut.isPending} className="flex-1 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40">
                {mut.isPending ? 'Completing…' : 'Mark Complete'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Create KT dialog ────────────────────────────────────────────────────────

function CreateKTDialog({ item, onClose, onSubmit }: { item: PreReadyItem; onClose: () => void; onSubmit: (qty: number, notes: string) => void }) {
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const value = parseFloat(qty || '0');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-theme-text">Create Kitchen Ticket</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={14} />
          </button>
        </header>
        <div className="p-6 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Quantity ({item.unit})</label>
            <input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-base font-bold text-theme-text outline-none border border-transparent focus:border-theme-accent" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent" />
          </div>
          <p className="text-[11px] text-theme-text-muted">
            Ingredients are deducted only when the production is marked Complete.
          </p>
        </div>
        <footer className="px-6 py-4 border-t border-theme-border flex gap-3">
          <button onClick={onClose} className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors">Cancel</button>
          <button onClick={() => onSubmit(value, notes)} disabled={value <= 0} className="flex-1 bg-theme-pop hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40">
            Send to Kitchen
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Waste dialog ────────────────────────────────────────────────────────────

function WasteDialog({ production, onClose, onSubmit }: { production: ProductionOrder; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-theme-text">Waste Production</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {production.preReadyItem?.name} × {Number(production.quantity).toFixed(2)} {production.preReadyItem?.unit}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={14} />
          </button>
        </header>
        <div className="p-6 space-y-3">
          <p className="text-xs text-theme-text-muted">
            The kitchen used the ingredients but the result was unusable. Stock will be deducted and the loss will be recorded as waste in reports.
          </p>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Burnt, contaminated" className="w-full bg-theme-bg rounded-theme px-3 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent" autoFocus />
          </div>
        </div>
        <footer className="px-6 py-4 border-t border-theme-border flex gap-3">
          <button onClick={onClose} className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors">Cancel</button>
          <button onClick={() => onSubmit(reason)} disabled={!reason.trim()} className="flex-1 bg-theme-danger hover:opacity-90 text-white font-bold py-3 rounded-theme transition-opacity disabled:opacity-40">
            Mark Wasted
          </button>
        </footer>
      </div>
    </div>
  );
}
