import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertTriangle, CheckCircle2, XCircle, Clock, Image as ImageIcon } from 'lucide-react';

import { api } from '../lib/api';
import type {
  ApproveShoppingRequestResult,
  MismatchReason,
  ShoppingRequest,
  ShoppingRequestStatus,
  Supplier,
  UpdateShoppingRequestDto,
} from '@restora/types';

/**
 * Admin desktop list + detail review for mobile shopping requests.
 * Filter by status / date / requester; tap a row to open the review
 * modal where each line gets a supplier picker + qty + cost
 * override. Approve fires the atomic transaction (mismatch writes
 * + DRAFT POs per supplier); reject prompts for a reason.
 */

const STATUS_PILL: Record<ShoppingRequestStatus, { bg: string; text: string; label: string; Icon: typeof Clock }> = {
  PENDING: { bg: 'bg-[#3a2e00]', text: 'text-[#FFA726]', label: 'Pending', Icon: Clock },
  APPROVED: { bg: 'bg-[#1a3a1a]', text: 'text-[#4CAF50]', label: 'Approved', Icon: CheckCircle2 },
  REJECTED: { bg: 'bg-[#3a1a1a]', text: 'text-[#D62B2B]', label: 'Rejected', Icon: XCircle },
};

const REASON_LABEL: Record<MismatchReason, string> = {
  WASTE: 'Waste',
  MISCALCULATION: 'Miscalculation',
  MISSING_PURCHASE: 'Missing purchase',
  ADJUSTMENT: 'Adjustment',
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthAgoIso = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

export default function ShoppingRequestsPage() {
  const [status, setStatus] = useState<ShoppingRequestStatus | ''>('PENDING');
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery<ShoppingRequest[]>({
    queryKey: ['shopping-requests', status, from, to],
    queryFn: () => {
      const p = new URLSearchParams({ from, to });
      if (status) p.set('status', status);
      return api.get<ShoppingRequest[]>(`/shopping-requests?${p.toString()}`);
    },
  });

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === 'PENDING').length,
    [requests],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">SHOPPING REQUESTS</h1>
          <p className="text-xs text-[#999] mt-1">Mobile-submitted lists awaiting review.</p>
        </div>
        {pendingCount > 0 && (
          <span className="bg-[#FFA726] text-black text-xs tracking-widest uppercase px-3 py-1.5 font-bold">
            {pendingCount} pending
          </span>
        )}
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] p-3 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#888] mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ShoppingRequestStatus | '')}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#888] mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[#888] mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#2A2A2A]">
              {['#', 'Requester', 'Lines', 'Mismatch', 'Submitted', 'Status', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] text-sm">Loading…</td></tr>
            )}
            {!isLoading && requests.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] text-sm">No requests in this window.</td></tr>
            )}
            {requests.map((req) => {
              const pill = STATUS_PILL[req.status];
              const mismatchCount = req.lines.filter((l) => l.mismatchReason).length;
              return (
                <tr key={req.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                  <td className="px-4 py-3 text-[#888] font-mono text-xs">#{req.id.slice(-6)}</td>
                  <td className="px-4 py-3 text-white font-body text-sm">{req.requestedBy?.name ?? '—'}<span className="text-[10px] text-[#666] ml-1">({req.requestedBy?.role ?? ''})</span></td>
                  <td className="px-4 py-3 text-[#ccc] font-body text-sm">{req.lines.length}</td>
                  <td className="px-4 py-3">
                    {mismatchCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[#FFA726] text-xs">
                        <AlertTriangle size={12} /> {mismatchCount}
                      </span>
                    ) : <span className="text-[#666] text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[#999] font-body text-xs">{new Date(req.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3">
                    <span className={`${pill.bg} ${pill.text} text-[10px] tracking-widest uppercase px-2 py-1 inline-flex items-center gap-1`}>
                      <pill.Icon size={10} /> {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setOpenId(req.id)} className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && <ReviewModal requestId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReviewModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [editedLines, setEditedLines] = useState<Map<string, { requestedQuantity?: string; supplierId?: string; unitCostPaisa?: string }>>(new Map());
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approveResult, setApproveResult] = useState<ApproveShoppingRequestResult | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const { data: request, isLoading } = useQuery<ShoppingRequest>({
    queryKey: ['shopping-request', requestId],
    queryFn: () => api.get<ShoppingRequest>(`/shopping-requests/${requestId}`),
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get<Supplier[]>('/suppliers'),
    select: (d) => d.filter((s) => s.isActive),
  });

  const editLine = (id: string, patch: { requestedQuantity?: string; supplierId?: string; unitCostPaisa?: string }) => {
    setEditedLines((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(prev.get(id) ?? {}), ...patch });
      return next;
    });
  };

  const saveEditsMut = useMutation({
    mutationFn: (dto: UpdateShoppingRequestDto) => api.patch<ShoppingRequest>(`/shopping-requests/${requestId}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-request', requestId] });
      qc.invalidateQueries({ queryKey: ['shopping-requests'] });
      setEditedLines(new Map());
    },
  });

  const approveMut = useMutation({
    mutationFn: () => api.post<ApproveShoppingRequestResult>(`/shopping-requests/${requestId}/approve`, {}),
    onSuccess: (data) => {
      setApproveResult(data);
      setApproveError(null);
      qc.invalidateQueries({ queryKey: ['shopping-request', requestId] });
      qc.invalidateQueries({ queryKey: ['shopping-requests'] });
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['purchasing'] });
    },
    onError: (e: unknown) => {
      setApproveError(e instanceof Error ? e.message : 'Approve failed');
    },
  });

  const rejectMut = useMutation({
    mutationFn: () => api.post<ShoppingRequest>(`/shopping-requests/${requestId}/reject`, { reason: rejectReason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-request', requestId] });
      qc.invalidateQueries({ queryKey: ['shopping-requests'] });
      onClose();
    },
  });

  const handleSaveAndApprove = async () => {
    if (editedLines.size > 0) {
      const dto: UpdateShoppingRequestDto = {
        lines: Array.from(editedLines.entries()).map(([id, patch]) => ({
          id,
          ...(patch.requestedQuantity !== undefined ? { requestedQuantity: patch.requestedQuantity === '' ? null : parseFloat(patch.requestedQuantity) } : {}),
          ...(patch.supplierId !== undefined ? { supplierId: patch.supplierId || null } : {}),
          ...(patch.unitCostPaisa !== undefined ? { unitCostPaisa: patch.unitCostPaisa === '' ? null : Math.round(parseFloat(patch.unitCostPaisa) * 100) } : {}),
        })),
      };
      await saveEditsMut.mutateAsync(dto);
    }
    approveMut.mutate();
  };

  const isPending = request?.status === 'PENDING';

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-[#161616] border border-[#2A2A2A] w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#2A2A2A] shrink-0">
          <div>
            <p className="text-[10px] text-[#D62B2B] tracking-widest uppercase">Shopping Request</p>
            <h2 className="font-display text-xl text-white tracking-wide">#{requestId.slice(-6)} · {request?.requestedBy?.name ?? '…'}</h2>
            {request && (
              <p className="text-[10px] text-[#666] mt-0.5">{new Date(request.createdAt).toLocaleString()}</p>
            )}
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X size={16} /></button>
        </header>

        <div className="overflow-auto p-5 space-y-3">
          {isLoading && <p className="text-[#666] text-sm text-center py-6">Loading…</p>}

          {approveResult && (
            <div className="bg-[#1a3a1a] border border-[#4CAF50] p-4 space-y-2">
              <p className="text-[#4CAF50] font-display tracking-widest text-sm">APPROVED</p>
              <ul className="text-xs text-[#ccc] space-y-1">
                <li>• {approveResult.createdPurchaseOrderIds.length} draft purchase order{approveResult.createdPurchaseOrderIds.length === 1 ? '' : 's'} created</li>
                <li>• {approveResult.wasteLogIds.length} waste log{approveResult.wasteLogIds.length === 1 ? '' : 's'} written</li>
                <li>• {approveResult.adjustmentMovementIds.length} stock adjustment{approveResult.adjustmentMovementIds.length === 1 ? '' : 's'} posted</li>
              </ul>
            </div>
          )}

          {approveError && (
            <div className="bg-[#3a1a1a] border border-[#D62B2B] text-[#F03535] text-sm p-3">{approveError}</div>
          )}

          {request?.notes && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-sm">
              <p className="text-[10px] text-[#666] tracking-widest uppercase">Staff notes</p>
              <p className="text-[#ccc] mt-1 italic">"{request.notes}"</p>
            </div>
          )}

          {request && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-[#666] tracking-widest uppercase">
                  <th className="text-left py-2">Ingredient</th>
                  <th className="text-right py-2 px-2">Software</th>
                  <th className="text-right py-2 px-2">Physical</th>
                  <th className="text-left py-2 px-2">Reason / Photo</th>
                  <th className="text-right py-2 px-2">Order qty</th>
                  <th className="text-left py-2 px-2">Supplier</th>
                  <th className="text-right py-2 px-2">Unit cost (৳)</th>
                </tr>
              </thead>
              <tbody>
                {request.lines.map((line) => {
                  const edits = editedLines.get(line.id);
                  const qtyValue = edits?.requestedQuantity ?? (line.requestedQuantity != null ? String(line.requestedQuantity) : '');
                  const supplierValue = edits?.supplierId ?? line.supplierId ?? '';
                  const costValue = edits?.unitCostPaisa ?? (line.unitCostPaisa != null ? String(line.unitCostPaisa / 100) : '');
                  return (
                    <tr key={line.id} className="border-t border-[#2A2A2A]">
                      <td className="py-2 align-top">
                        <p className="text-white">{line.ingredient?.name ?? line.ingredientId}</p>
                        <p className="text-[10px] text-[#888]">{line.ingredient?.unit}</p>
                      </td>
                      <td className="py-2 px-2 text-right text-[#ccc] align-top">
                        {line.softwareCountAtTime != null ? Number(line.softwareCountAtTime).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-2 text-right text-[#ccc] align-top">
                        {line.physicalCount != null ? Number(line.physicalCount).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-2 align-top">
                        {line.mismatchReason ? (
                          <div className="space-y-1">
                            <span className="inline-block bg-[#3a2e00] text-[#FFA726] text-[10px] tracking-widest uppercase px-2 py-0.5">
                              {REASON_LABEL[line.mismatchReason]}
                            </span>
                            {line.mismatchPhotoUrl && (
                              <a href={line.mismatchPhotoUrl} target="_blank" rel="noreferrer" className="block">
                                <img src={line.mismatchPhotoUrl} alt="Waste" className="h-12 w-12 object-cover border border-[#2A2A2A]" />
                              </a>
                            )}
                            {!line.mismatchPhotoUrl && line.mismatchReason === 'WASTE' && (
                              <p className="text-[10px] text-[#666] inline-flex items-center gap-1"><ImageIcon size={10} /> no photo</p>
                            )}
                            {line.mismatchNotes && <p className="text-[10px] text-[#888] italic">"{line.mismatchNotes}"</p>}
                          </div>
                        ) : <span className="text-[#666]">—</span>}
                      </td>
                      <td className="py-2 px-2 align-top">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!isPending}
                          value={qtyValue}
                          onChange={(e) => editLine(line.id, { requestedQuantity: e.target.value })}
                          className="w-24 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm text-right disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2 px-2 align-top">
                        <select
                          disabled={!isPending}
                          value={supplierValue}
                          onChange={(e) => editLine(line.id, { supplierId: e.target.value })}
                          className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm disabled:opacity-50 max-w-[180px]"
                        >
                          <option value="">(auto from ingredient default)</option>
                          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2 align-top">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!isPending}
                          value={costValue}
                          onChange={(e) => editLine(line.id, { unitCostPaisa: e.target.value })}
                          placeholder={line.ingredient?.costPerPurchaseUnit != null ? (line.ingredient.costPerPurchaseUnit / 100).toFixed(2) : '0'}
                          className="w-24 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-sm text-right disabled:opacity-50"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {request?.status === 'APPROVED' && request.approvedBy && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 text-xs text-[#888]">
              Approved by {request.approvedBy.name} on {request.approvedAt && new Date(request.approvedAt).toLocaleString()}
            </div>
          )}

          {request?.status === 'REJECTED' && (
            <div className="bg-[#3a1a1a] border border-[#D62B2B] p-3 text-xs text-[#F03535]">
              Rejected: {request.rejectionReason}
            </div>
          )}
        </div>

        {isPending && !approveResult && (
          <footer className="border-t border-[#2A2A2A] p-3 flex items-center justify-end gap-2 shrink-0">
            {rejectMode ? (
              <>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection…"
                  autoFocus
                  className="flex-1 bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B]"
                />
                <button
                  onClick={() => setRejectMode(false)}
                  className="text-[#666] hover:text-white text-xs tracking-widest uppercase px-3 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => rejectMut.mutate()}
                  disabled={!rejectReason.trim() || rejectMut.isPending}
                  className="bg-[#D62B2B] hover:bg-[#F03535] disabled:opacity-50 text-white font-body text-xs px-4 py-2 tracking-widest uppercase"
                >
                  {rejectMut.isPending ? 'Rejecting…' : 'Confirm reject'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setRejectMode(true)}
                  className="text-[#D62B2B] hover:text-white border border-[#D62B2B] font-body text-xs px-4 py-2 tracking-widest uppercase"
                >
                  Reject
                </button>
                <button
                  onClick={handleSaveAndApprove}
                  disabled={approveMut.isPending || saveEditsMut.isPending}
                  className="bg-[#4CAF50] hover:bg-[#66BB6A] disabled:opacity-50 text-black font-body text-xs px-5 py-2 tracking-widest uppercase font-bold"
                >
                  {approveMut.isPending || saveEditsMut.isPending ? 'Approving…' : 'Approve & generate POs'}
                </button>
              </>
            )}
          </footer>
        )}

        {approveResult && (
          <footer className="border-t border-[#2A2A2A] p-3 flex items-center justify-end shrink-0">
            <button onClick={onClose} className="bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white font-body text-xs px-5 py-2 tracking-widest uppercase">
              Close
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
