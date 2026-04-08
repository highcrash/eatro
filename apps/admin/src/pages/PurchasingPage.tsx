import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PurchaseOrder, Supplier, Ingredient, CreatePurchaseOrderDto, PurchaseReturn } from '@restora/types';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'text-[#FFA726] bg-[#3a2e00]',
  SENT: 'text-[#29B6F6] bg-[#00243a]',
  PARTIAL: 'text-[#CE93D8] bg-[#2a003a]',
  RECEIVED: 'text-[#4CAF50] bg-[#1a3a1a]',
  CANCELLED: 'text-[#666] bg-[#2A2A2A]',
};

const RETURN_STATUS_COLORS: Record<string, string> = {
  REQUESTED: 'text-[#FFA726] bg-[#3a2e00]',
  APPROVED: 'text-[#29B6F6] bg-[#00243a]',
  COMPLETED: 'text-[#4CAF50] bg-[#1a3a1a]',
  REJECTED: 'text-[#666] bg-[#2A2A2A]',
};

const CONVERSION_MAP: Record<string, string[]> = {
  KG: ['KG', 'G'], G: ['G', 'KG'],
  L: ['L', 'ML'], ML: ['ML', 'L'],
  DOZEN: ['DOZEN', 'PCS'], PCS: ['PCS', 'DOZEN'],
  BOX: ['BOX'],
};

function getConvertibleUnits(unit: string): string[] {
  return CONVERSION_MAP[unit] ?? [unit];
}

interface POLineItem {
  ingredientId: string;
  quantityOrdered: string;
  unit: string;
  unitCost: string; // in Taka
}

// Helper: get the display unit for purchasing context (purchaseUnit if set, else stock unit)
function poUnit(ingredient?: { unit?: string; purchaseUnit?: string | null } | null, itemUnit?: string | null): string {
  return itemUnit || ingredient?.purchaseUnit || ingredient?.unit || '';
}

// ─── Print helpers ─────────────────────────────────────────────────────────

function printPO(po: PurchaseOrder, includePrice: boolean) {
  const hasReceived = po.items.some((i) => Number(i.quantityReceived) > 0);
  const td = 'padding:4px 8px;border-bottom:1px solid #eee';

  const rows = po.items.map((item) => {
    const unit = poUnit(item.ingredient, (item as any).unit);
    const ordered = `${Number(item.quantityOrdered).toFixed(3)} ${unit}`;
    const received = hasReceived ? `${Number(item.quantityReceived).toFixed(3)}` : '';
    const price = includePrice ? `৳${(Number(item.unitCost) / 100).toFixed(2)}` : '';
    const total = includePrice ? `৳${((Number(item.unitCost) / 100) * Number(item.quantityReceived || item.quantityOrdered)).toFixed(2)}` : '';
    return `<tr>
      <td style="${td}">${item.ingredient?.name ?? ''}</td>
      <td style="text-align:right;${td}">${ordered}</td>
      ${hasReceived ? `<td style="text-align:right;${td}">${received}</td>` : ''}
      ${includePrice ? `<td style="text-align:right;${td}">${price}</td><td style="text-align:right;${td}">${total}</td>` : ''}
    </tr>`;
  }).join('');

  const grandTotal = includePrice
    ? po.items.reduce((s, i) => s + (Number(i.unitCost) / 100) * Number(i.quantityReceived || i.quantityOrdered), 0)
    : 0;

  const statusLabel = po.status === 'RECEIVED' ? 'RECEIVED' : po.status === 'PARTIAL' ? 'PARTIALLY RECEIVED' : po.status;

  const w = window.open('', '_blank', 'width=700,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>PO ${po.id.slice(-8).toUpperCase()}</title><style>body{font-family:sans-serif;padding:20px;font-size:13px}table{width:100%;border-collapse:collapse}th{text-align:left;padding:6px 8px;border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:1px}h2{margin:0}p{margin:4px 0}.status{display:inline-block;padding:2px 8px;font-size:11px;font-weight:bold;letter-spacing:1px}</style></head><body>
    <h2>Purchase Order <span class="status">${statusLabel}</span></h2>
    <p style="color:#666;margin-bottom:16px">PO# ${po.id.slice(-8).toUpperCase()} | ${po.supplier?.name ?? ''} | ${new Date(po.createdAt).toLocaleDateString()}${po.receivedAt ? ` | Received: ${new Date(po.receivedAt).toLocaleDateString()}` : ''}</p>
    <table><thead><tr><th>Ingredient</th><th style="text-align:right">Ordered</th>${hasReceived ? '<th style="text-align:right">Received</th>' : ''}${includePrice ? '<th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    ${includePrice ? `<p style="text-align:right;font-size:18px;font-weight:bold;margin-top:16px;border-top:2px solid #333;padding-top:8px">Grand Total: ৳${grandTotal.toFixed(2)}</p>` : ''}
    ${po.notes ? `<p style="color:#666;margin-top:12px">Notes: ${po.notes}</p>` : ''}
  </body></html>`);
  w.document.close();
  w.print();
}

function printReturn(ret: PurchaseReturn) {
  const rows = ret.items.map((item) => {
    const qty = `${Number(item.quantity).toFixed(2)} ${poUnit(item.ingredient)}`;
    const price = `৳${(Number(item.unitPrice) / 100).toFixed(2)}`;
    const total = `৳${((Number(item.unitPrice) / 100) * Number(item.quantity)).toFixed(2)}`;
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${item.ingredient?.name ?? ''}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${qty}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${price}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${total}</td></tr>`;
  }).join('');

  const grandTotal = ret.items.reduce((s, i) => s + (Number(i.unitPrice) / 100) * Number(i.quantity), 0);

  const w = window.open('', '_blank', 'width=600,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>Return ${ret.id.slice(-8).toUpperCase()}</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th{text-align:left;padding:6px 8px;border-bottom:2px solid #333;font-size:12px;text-transform:uppercase}</style></head><body>
    <h2 style="margin:0">Purchase Return</h2>
    <p style="color:#666;margin:4px 0 16px">Return# ${ret.id.slice(-8).toUpperCase()} | ${ret.supplier?.name ?? ''} | ${new Date(ret.createdAt).toLocaleDateString()}</p>
    <table><thead><tr><th>Ingredient</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="text-align:right;font-size:18px;font-weight:bold;margin-top:16px">Grand Total: ৳${grandTotal.toFixed(2)}</p>
    ${ret.notes ? `<p style="color:#666;margin-top:12px">Notes: ${ret.notes}</p>` : ''}
  </body></html>`);
  w.document.close();
  w.print();
}

// ─── Main component ────────────────────────────────────────────────────────

export default function PurchasingPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'returns' | 'return-create'>('list');
  const [indReturnSupplierId, setIndReturnSupplierId] = useState('');
  const [indReturnLines, setIndReturnLines] = useState<{ ingredientId: string; quantity: string; unitPrice: string }[]>([]);
  const [indReturnNotes, setIndReturnNotes] = useState('');
  const [indReturnSearch, setIndReturnSearch] = useState<Record<number, string>>({});
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState<{ supplierId: string; notes: string; expectedAt: string }>({
    supplierId: '', notes: '', expectedAt: '',
  });
  const [lines, setLines] = useState<POLineItem[]>([{ ingredientId: '', quantityOrdered: '0', unit: 'PCS', unitCost: '0' }]);
  const [ingSearchPO, setIngSearchPO] = useState<Record<number, string>>({});
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [receivePrices, setReceivePrices] = useState<Record<string, string>>({});
  const [receiveNotes, setReceiveNotes] = useState('');

  // Return form state
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [returnLines, setReturnLines] = useState<{ ingredientId: string; name: string; unit: string; quantity: string; unitPrice: string }[]>([]);
  const [returnNotes, setReturnNotes] = useState('');

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => api.get(`/purchasing${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    select: (d) => d.filter((s) => s.isActive),
  });

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients'],
    queryFn: () => api.get('/ingredients'),
    select: (d) => d.filter((i) => i.isActive),
  });

  const { data: returns = [] } = useQuery<PurchaseReturn[]>({
    queryKey: ['purchase-returns'],
    queryFn: () => api.get('/purchasing/returns'),
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreatePurchaseOrderDto) => api.post('/purchasing', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setView('list');
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/${id}/send`, {}),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setSelectedPO(updated as PurchaseOrder);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/${id}/cancel`, {}),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setSelectedPO(updated as PurchaseOrder);
    },
  });

  const receiveMutation = useMutation({
    mutationFn: ({ id, items, notes }: { id: string; items: { purchaseOrderItemId: string; quantityReceived: number; unitPrice?: number }[]; notes: string }) =>
      api.post(`/purchasing/${id}/receive`, { items, notes }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['stock-movements'] });
      setSelectedPO(updated as PurchaseOrder);
      setReceiveQtys({});
      setReceivePrices({});
      setReceiveNotes('');
    },
  });

  const returnMutation = useMutation({
    mutationFn: ({ poId, items, notes }: { poId: string; items: { ingredientId: string; quantity: number; unitPrice: number }[]; notes?: string }) =>
      api.post(`/purchasing/${poId}/return`, { items, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      setShowReturnForm(false);
      setReturnLines([]);
      setReturnNotes('');
    },
  });

  const indReturnMutation = useMutation({
    mutationFn: () => {
      const items = indReturnLines
        .filter((l) => l.ingredientId && parseFloat(l.quantity) > 0)
        .map((l) => ({ ingredientId: l.ingredientId, quantity: parseFloat(l.quantity), unitPrice: Math.round((parseFloat(l.unitPrice) || 0) * 100) }));
      return api.post('/purchasing/returns/create', { supplierId: indReturnSupplierId, items, notes: indReturnNotes || undefined });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      setView('list');
      setIndReturnLines([]);
      setIndReturnNotes('');
      setIndReturnSupplierId('');
    },
  });

  const closePartialMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/${id}/close-partial`, {}),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setSelectedPO(updated as PurchaseOrder);
    },
  });

  const rejectReturnMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/returns/${id}/reject`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['purchase-returns'] }); },
  });

  const cancelReturnMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/returns/${id}/cancel`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['purchase-returns'] }); },
  });

  const completeReturnMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchasing/returns/${id}/complete`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const handleCreate = () => {
    const validLines = lines.filter((l) => l.ingredientId && parseFloat(l.quantityOrdered) > 0);
    if (!form.supplierId || validLines.length === 0) return;
    createMutation.mutate({
      supplierId: form.supplierId,
      notes: form.notes || undefined,
      expectedAt: form.expectedAt || undefined,
      items: validLines.map((l) => ({
        ingredientId: l.ingredientId,
        quantityOrdered: parseFloat(l.quantityOrdered),
        unitCost: Math.round((parseFloat(l.unitCost) || 0) * 100), // Taka -> paisa
        unit: l.unit,
      })),
    });
  };

  const handleReceive = () => {
    if (!selectedPO) return;
    const items = selectedPO.items
      .filter((item) => receiveQtys[item.id] && parseFloat(receiveQtys[item.id]) > 0)
      .map((item) => {
        const priceStr = receivePrices[item.id];
        const unitPrice = priceStr ? Math.round(parseFloat(priceStr) * 100) : undefined; // Taka -> paisa
        return { purchaseOrderItemId: item.id, quantityReceived: parseFloat(receiveQtys[item.id]), unitPrice };
      });
    if (items.length === 0) return;
    receiveMutation.mutate({ id: selectedPO.id, items, notes: receiveNotes });
  };

  const [returnError, setReturnError] = useState('');

  const handleCreateReturn = () => {
    if (!selectedPO) return;
    setReturnError('');
    const items = returnLines
      .filter((l) => parseFloat(l.quantity) > 0)
      .map((l) => ({
        ingredientId: l.ingredientId,
        quantity: parseFloat(l.quantity),
        unitPrice: Math.round((parseFloat(l.unitPrice) || 0) * 100), // Taka -> paisa
      }));
    if (items.length === 0) {
      setReturnError('Enter quantity for at least one item to return');
      return;
    }
    returnMutation.mutate({ poId: selectedPO.id, items, notes: returnNotes || undefined });
  };

  const openDetail = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setShowReceiveForm(false);
    setShowReturnForm(false);
    setReceiveQtys({});
    setReceivePrices({});
    setReceiveNotes('');
    setShowReturnForm(false);
    setView('detail');
  };

  const resetCreate = () => {
    setForm({ supplierId: '', notes: '', expectedAt: '' });
    setLines([{ ingredientId: '', quantityOrdered: '0', unit: 'PCS', unitCost: '0' }]);
    setIngSearchPO({});
    setView('create');
  };

  const openReturnForm = () => {
    if (!selectedPO) return;
    setReturnLines(selectedPO.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.ingredient?.name ?? '',
      unit: poUnit(item.ingredient, (item as any).unit),
      quantity: '0',
      unitPrice: String((Number(item.unitCost) / 100).toFixed(2)),
    })));
    setReturnNotes('');
    setReturnError('');
    setShowReturnForm(true);
  };

  const addLine = () => setLines((l) => [...l, { ingredientId: '', quantityOrdered: '0', unit: 'PCS', unitCost: '0' }]);
  const removeLine = (i: number) => {
    setLines((l) => l.filter((_, idx) => idx !== i));
    setIngSearchPO((s) => { const next = { ...s }; delete next[i]; return next; });
  };
  const updateLine = (i: number, key: keyof POLineItem, value: string) =>
    setLines((l) => l.map((item, idx) => (idx === i ? { ...item, [key]: value } : item)));

  // Grand total in Taka
  const grandTotal = lines.reduce((sum, l) => {
    const qty = parseFloat(l.quantityOrdered) || 0;
    const cost = parseFloat(l.unitCost) || 0;
    return sum + qty * cost;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-white tracking-widest">PURCHASING</h1>
        <div className="flex gap-3">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999] font-body text-sm px-4 py-2 transition-colors">
              ← Back
            </button>
          )}
          {view === 'list' && (
            <>
              <button onClick={() => setView('returns')} className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999] font-body text-sm px-4 py-2 transition-colors">
                RETURNS
              </button>
              <button onClick={() => { setView('return-create'); setIndReturnSupplierId(''); setIndReturnLines([{ ingredientId: '', quantity: '0', unitPrice: '0' }]); setIndReturnNotes(''); setIndReturnSearch({}); }} className="bg-[#FFA726] hover:bg-[#FFB74D] text-[#0D0D0D] font-body text-sm px-4 py-2 transition-colors">
                RETURN TO SUPPLIER
              </button>
              <button onClick={resetCreate} className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors">
                + NEW ORDER
              </button>
            </>
          )}
        </div>
      </div>

      {/* List View */}
      {view === 'list' && (
        <>
          {/* Status filter */}
          <div className="flex gap-2">
            {['', 'DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 font-body text-xs tracking-widest uppercase transition-colors ${
                  statusFilter === s ? 'bg-[#D62B2B] text-white' : 'bg-[#1F1F1F] text-[#666] hover:text-[#999]'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          {isLoading ? <p className="text-[#666] font-body text-sm">Loading…</p> : (
            <div className="bg-[#161616] border border-[#2A2A2A]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2A2A2A]">
                    {['PO #', 'Supplier', 'Items', 'Status', 'Created', 'Actions'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po) => (
                    <tr key={po.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                      <td className="px-4 py-3 font-mono text-white text-xs">{po.id.slice(-8).toUpperCase()}</td>
                      <td className="px-4 py-3 text-white font-body text-sm">{po.supplier?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-sm">{po.items.length}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-body px-2 py-0.5 ${STATUS_COLORS[po.status] ?? ''}`}>{po.status}</span>
                      </td>
                      <td className="px-4 py-3 text-[#666] font-body text-xs">{new Date(po.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => openDetail(po)} className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors">
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[#666] font-body text-sm">No purchase orders yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Create View */}
      {view === 'create' && (
        <div className="max-w-3xl space-y-6">
          <div className="bg-[#161616] border border-[#2A2A2A] p-6 space-y-4">
            <h2 className="font-display text-xl text-white tracking-widest mb-4">NEW PURCHASE ORDER</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Supplier *</label>
                <select
                  value={form.supplierId}
                  onChange={(e) => {
                    const sid = e.target.value;
                    setForm((f) => ({ ...f, supplierId: sid }));
                    if (sid) {
                      const lowStock = ingredients.filter((i) => {
                        const linked = i.supplierId === sid || i.suppliers?.some((s: { supplierId: string }) => s.supplierId === sid);
                        const low = Number(i.currentStock) <= Number(i.minimumStock);
                        return linked && low;
                      });
                      if (lowStock.length > 0) {
                        setLines(lowStock.map((i) => {
                          const hasPurchaseUnit = i.purchaseUnit && Number(i.purchaseUnitQty) > 0;
                          const stockDeficit = Math.max(0, Number(i.minimumStock) * 2 - Number(i.currentStock));
                          const qty = hasPurchaseUnit ? Math.ceil(stockDeficit / Number(i.purchaseUnitQty)) : stockDeficit;
                          const cost = hasPurchaseUnit && Number(i.costPerPurchaseUnit) > 0
                            ? (Number(i.costPerPurchaseUnit) / 100).toFixed(2)
                            : (Number(i.costPerUnit) / 100).toFixed(2);
                          return {
                            ingredientId: i.id,
                            quantityOrdered: String(qty),
                            unit: i.purchaseUnit || i.unit,
                            unitCost: cost,
                          };
                        }));
                        setIngSearchPO({});
                      }
                    }
                  }}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                >
                  <option value="">— Select Supplier —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Expected Date</label>
                <input
                  type="date"
                  value={form.expectedAt}
                  onChange={(e) => setForm((f) => ({ ...f, expectedAt: e.target.value }))}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
              />
            </div>
          </div>

          {/* Line items */}
          <div className="bg-[#161616] border border-[#2A2A2A] p-6">
            <h3 className="font-display text-lg text-white tracking-widest mb-4">ORDER ITEMS</h3>
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-3 text-[#666] text-xs font-body tracking-widest uppercase">Ingredient (search)</div>
              <div className="col-span-1 text-[#666] text-xs font-body tracking-widest uppercase text-right">Stock</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Qty</div>
              <div className="col-span-1 text-[#666] text-xs font-body tracking-widest uppercase">Unit</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Cost (৳)</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase text-right">Total</div>
              <div className="col-span-1"></div>
            </div>
            {lines.map((line, idx) => {
              const selIng = ingredients.find((i) => i.id === line.ingredientId);
              const nativeUnit = selIng?.unit ?? 'PCS';
              const purchaseUnit = selIng?.purchaseUnit;
              // If purchaseUnit is set, only show that — no other units to avoid confusion
              const convertible = purchaseUnit ? [purchaseUnit] : [...new Set(getConvertibleUnits(nativeUnit))];
              const qty = parseFloat(line.quantityOrdered) || 0;
              const cost = parseFloat(line.unitCost) || 0;
              const lineTotal = qty * cost;

              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-3">
                    <input
                      list={`po-ing-${idx}`}
                      value={ingSearchPO[idx] !== undefined ? ingSearchPO[idx] : (selIng ? `${selIng.name} (${selIng.purchaseUnit || selIng.unit})` : '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIngSearchPO((s) => ({ ...s, [idx]: val }));
                        const match = ingredients.find((i) => `${i.name} (${i.purchaseUnit || i.unit})` === val || `${i.name} (${i.unit})` === val || (i.itemCode ?? '') === val);
                        if (match) {
                          const pu = match.purchaseUnit && Number(match.purchaseUnitQty) > 0;
                          const cost = pu && Number(match.costPerPurchaseUnit) > 0
                            ? (Number(match.costPerPurchaseUnit) / 100).toFixed(2)
                            : (Number(match.costPerUnit) / 100).toFixed(2);
                          setLines((l) => l.map((item, i) => i === idx ? { ...item, ingredientId: match.id, unit: match.purchaseUnit || match.unit, unitCost: cost } : item));
                          setIngSearchPO((s) => { const next = { ...s }; delete next[idx]; return next; });
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="Type name or code…"
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                    <datalist id={`po-ing-${idx}`}>
                      {ingredients.filter((i) => {
                        const s = (ingSearchPO[idx] ?? '').toLowerCase().trim();
                        return !s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s);
                      }).slice(0, 30).map((i) => (
                        <option key={i.id} value={`${i.name} (${i.purchaseUnit || i.unit})`}>{i.itemCode ? `[${i.itemCode}] ` : ''}{i.name} {i.purchaseUnit ? `[${i.purchaseUnit}]` : ''} — Stock: {Number(i.currentStock).toFixed(1)} {i.unit}</option>
                      ))}
                    </datalist>
                  </div>
                  <div className="col-span-1 text-right">
                    {selIng && (
                      <span className={`text-xs font-body ${Number(selIng.currentStock) <= Number(selIng.minimumStock) ? 'text-[#D62B2B]' : 'text-[#666]'}`}>
                        {Number(selIng.currentStock).toFixed(1)} {selIng.unit}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.001" min="0"
                      value={line.quantityOrdered}
                      onChange={(e) => updateLine(idx, 'quantityOrdered', e.target.value)}
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                  </div>
                  <div className="col-span-1">
                    <select
                      value={line.unit}
                      onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    >
                      {convertible.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number" step="0.01" min="0"
                      value={line.unitCost}
                      onChange={(e) => updateLine(idx, 'unitCost', e.target.value)}
                      placeholder="৳ per unit"
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-white font-body text-sm font-medium">
                      {lineTotal > 0 ? `৳${lineTotal.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => removeLine(idx)} className="text-[#666] hover:text-[#D62B2B] font-body text-xs px-1 transition-colors">✕</button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={addLine}
              className="mt-2 text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors border border-dashed border-[#2A2A2A] hover:border-[#D62B2B] w-full py-2"
            >
              + Add Item
            </button>

            {/* Grand Total */}
            {grandTotal > 0 && (
              <div className="mt-4 pt-4 border-t border-[#2A2A2A] flex justify-between items-center">
                <span className="font-display text-lg text-white tracking-widest">GRAND TOTAL</span>
                <span className="font-display text-2xl text-[#D62B2B]">৳{grandTotal.toFixed(2)}</span>
              </div>
            )}
          </div>

          {createMutation.error && (
            <p className="text-[#F03535] text-xs font-body">{(createMutation.error as Error).message}</p>
          )}
          <button
            onClick={handleCreate}
            disabled={!form.supplierId || createMutation.isPending}
            className="bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-6 py-3 transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Purchase Order'}
          </button>
        </div>
      )}

      {/* Detail View */}
      {view === 'detail' && selectedPO && (
        <div className="max-w-3xl space-y-6">
          {/* PO Header */}
          <div className="bg-[#161616] border border-[#2A2A2A] p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Purchase Order</p>
                <p className="font-mono text-white text-2xl">{selectedPO.id.slice(-8).toUpperCase()}</p>
              </div>
              <span className={`text-sm font-body px-3 py-1 ${STATUS_COLORS[selectedPO.status] ?? ''}`}>{selectedPO.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Supplier</p>
                <p className="text-white font-body">{selectedPO.supplier?.name}</p>
              </div>
              <div>
                <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Created by</p>
                <p className="text-white font-body">{selectedPO.createdBy?.name}</p>
              </div>
              {selectedPO.expectedAt && (
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Expected</p>
                  <p className="text-white font-body">{new Date(selectedPO.expectedAt).toLocaleDateString()}</p>
                </div>
              )}
              {selectedPO.notes && (
                <div>
                  <p className="text-[#666] font-body text-xs tracking-widest uppercase mb-1">Notes</p>
                  <p className="text-white font-body">{selectedPO.notes}</p>
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="flex gap-2 mt-4">
              {selectedPO.status === 'DRAFT' && (
                <button
                  onClick={() => sendMutation.mutate(selectedPO.id)}
                  disabled={sendMutation.isPending}
                  className="bg-[#29B6F6] hover:bg-[#4fc3f7] text-[#0D0D0D] font-body font-medium text-sm px-4 py-2 transition-colors disabled:opacity-50"
                >
                  Mark as Sent
                </button>
              )}
              {(selectedPO.status === 'SENT' || selectedPO.status === 'PARTIAL') && !showReturnForm && (
                <button
                  onClick={() => { setShowReceiveForm(true); setShowReturnForm(false); }}
                  className={`font-body font-medium text-sm px-4 py-2 transition-colors ${showReceiveForm ? 'bg-[#4CAF50] text-white' : 'bg-[#2A2A2A] hover:bg-[#4CAF50] text-[#999] hover:text-white'}`}
                >
                  {showReceiveForm ? '▾ Receive Goods' : 'Receive Goods'}
                </button>
              )}
              {(selectedPO.status === 'RECEIVED' || selectedPO.status === 'PARTIAL') && !showReceiveForm && (
                <button
                  onClick={() => { openReturnForm(); setShowReceiveForm(false); }}
                  className={`font-body font-medium text-sm px-4 py-2 transition-colors ${showReturnForm ? 'bg-[#FFA726] text-[#0D0D0D]' : 'bg-[#2A2A2A] hover:bg-[#FFA726] text-[#999] hover:text-[#0D0D0D]'}`}
                >
                  {showReturnForm ? '▾ Return Goods' : 'Return Goods'}
                </button>
              )}
              {selectedPO.status === 'PARTIAL' && (
                <button
                  onClick={() => { if (confirm('Close this order partially? No more goods can be received.')) closePartialMutation.mutate(selectedPO.id); }}
                  disabled={closePartialMutation.isPending}
                  className="bg-[#2A2A2A] hover:bg-[#CE93D8] text-[#999] hover:text-[#0D0D0D] font-body text-sm px-4 py-2 transition-colors disabled:opacity-50"
                >
                  {closePartialMutation.isPending ? 'Closing…' : 'Close Order'}
                </button>
              )}
              {(selectedPO.status === 'DRAFT' || selectedPO.status === 'SENT') && (
                <button
                  onClick={() => cancelMutation.mutate(selectedPO.id)}
                  disabled={cancelMutation.isPending}
                  className="bg-[#2A2A2A] hover:bg-[#D62B2B] text-[#999] hover:text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}
              <button
                onClick={() => printPO(selectedPO, selectedPO.status === 'RECEIVED' || selectedPO.status === 'PARTIAL')}
                className="bg-[#2A2A2A] hover:bg-[#333] text-[#999] hover:text-white font-body text-sm px-4 py-2 transition-colors"
              >
                Print
              </button>
            </div>
          </div>

          {/* Items */}
          <div className="bg-[#161616] border border-[#2A2A2A] p-6">
            <h3 className="font-display text-lg text-white tracking-widest mb-4">ITEMS</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Ingredient', 'Ordered', 'Received', 'Unit Price', 'Total', 'Status'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedPO.items.map((item) => {
                  const pct = Math.round((item.quantityReceived / item.quantityOrdered) * 100);
                  return (
                    <tr key={item.id} className="border-b border-[#2A2A2A] last:border-0">
                      <td className="px-3 py-3 text-white font-body text-sm">{item.ingredient?.name}</td>
                      <td className="px-3 py-3 text-[#999] font-body text-sm">{Number(item.quantityOrdered).toFixed(3)} {poUnit(item.ingredient, (item as any).unit)}</td>
                      <td className="px-3 py-3 text-[#999] font-body text-sm">{Number(item.quantityReceived).toFixed(3)}</td>
                      <td className="px-3 py-3 text-[#999] font-body text-sm">৳{(Number(item.unitCost) / 100).toFixed(2)}</td>
                      <td className="px-3 py-3 text-white font-body text-sm">৳{((Number(item.unitCost) / 100) * Number(item.quantityOrdered)).toFixed(2)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-body ${pct >= 100 ? 'text-[#4CAF50]' : pct > 0 ? 'text-[#FFA726]' : 'text-[#666]'}`}>
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* PO Total */}
            <div className="mt-4 pt-4 border-t border-[#2A2A2A] flex justify-end">
              <span className="font-display text-lg text-[#D62B2B]">
                Total: ৳{selectedPO.items.reduce((s, i) => s + (Number(i.unitCost) / 100) * Number(i.quantityOrdered), 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Purchase Returns for this PO */}
          {(() => {
            const poReturns = returns.filter((r) => r.purchaseOrderId === selectedPO.id);
            if (poReturns.length === 0) return null;
            return (
              <div className="bg-[#161616] border border-[#2A2A2A] p-6">
                <h3 className="font-display text-lg text-white tracking-widest mb-4">PURCHASE RETURNS</h3>
                <div className="space-y-4">
                  {poReturns.map((ret) => (
                    <div key={ret.id} className="border border-[#2A2A2A] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-body px-2 py-0.5 ${
                            ret.status === 'REQUESTED' ? 'text-[#FFA726] bg-[#3a2e00]' :
                            ret.status === 'COMPLETED' ? 'text-[#4CAF50] bg-[#1a3a1a]' :
                            ret.status === 'REJECTED' ? 'text-[#D62B2B] bg-[#3a1a1a]' :
                            'text-[#666] bg-[#2A2A2A]'
                          }`}>{ret.status}</span>
                          <span className="text-[#666] font-body text-xs">{new Date(ret.createdAt).toLocaleDateString()}</span>
                          <span className="text-[#666] font-body text-xs">by {ret.requestedBy?.name}</span>
                        </div>
                        <div className="flex gap-2">
                          {ret.status === 'REQUESTED' && (
                            <>
                              <button
                                onClick={() => completeReturnMutation.mutate(ret.id)}
                                disabled={completeReturnMutation.isPending}
                                className="text-[#4CAF50] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                              >
                                Complete
                              </button>
                              <button
                                onClick={() => rejectReturnMutation.mutate(ret.id)}
                                disabled={rejectReturnMutation.isPending}
                                className="text-[#D62B2B] hover:text-[#F03535] font-body text-xs tracking-widest uppercase transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {(ret.status === 'REQUESTED' || ret.status === 'APPROVED') && (
                            <button
                              onClick={() => cancelReturnMutation.mutate(ret.id)}
                              disabled={cancelReturnMutation.isPending}
                              className="text-[#999] hover:text-[#D62B2B] font-body text-xs tracking-widest uppercase transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                      {ret.notes && <p className="text-[#666] font-body text-xs mb-2">{ret.notes}</p>}
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[#2A2A2A]">
                            {['Item', 'Qty', 'Unit Price', 'Total'].map((h) => (
                              <th key={h} className="text-left px-2 py-1 text-[#666] font-body text-[10px] tracking-widest uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ret.items.map((item) => (
                            <tr key={item.id} className="border-b border-[#2A2A2A] last:border-0">
                              <td className="px-2 py-2 text-white font-body text-xs">{item.ingredient?.name}</td>
                              <td className="px-2 py-2 text-[#999] font-body text-xs">{Number(item.quantity).toFixed(3)} {poUnit(item.ingredient)}</td>
                              <td className="px-2 py-2 text-[#999] font-body text-xs">৳{(Number(item.unitPrice) / 100).toFixed(2)}</td>
                              <td className="px-2 py-2 text-[#D62B2B] font-body text-xs">৳{((Number(item.unitPrice) / 100) * Number(item.quantity)).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-2 pt-2 border-t border-[#2A2A2A] flex justify-end">
                        <span className="text-[#D62B2B] font-body text-sm font-medium">
                          Return Total: ৳{ret.items.reduce((s, i) => s + (Number(i.unitPrice) / 100) * Number(i.quantity), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Receive Goods form */}
          {showReceiveForm && (selectedPO.status === 'SENT' || selectedPO.status === 'PARTIAL') && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-6 max-h-[60vh] overflow-auto">
              <h3 className="font-display text-lg text-white tracking-widest mb-4 sticky top-0 bg-[#161616] pb-2 z-10">RECEIVE GOODS</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3 items-center mb-2">
                  <div className="col-span-4 text-[#666] text-xs font-body tracking-widest uppercase">Item</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Qty Receiving</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Unit Price (৳)</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase text-right">Line Total</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Unit</div>
                </div>
                {selectedPO.items.map((item) => {
                  const rqty = parseFloat(receiveQtys[item.id] ?? '0') || 0;
                  const rprice = parseFloat(receivePrices[item.id] ?? '') || (Number(item.unitCost) / 100);
                  const lineTotal = rqty * rprice;
                  return (
                    <div key={item.id} className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-4">
                        <p className="text-white font-body text-sm">{item.ingredient?.name}</p>
                        <p className="text-[#666] font-body text-xs">
                          Ordered: {Number(item.quantityOrdered).toFixed(3)} | Received: {Number(item.quantityReceived).toFixed(3)}
                          {item.ingredient && <span className="ml-2 text-[#999]">Stock: {Number((item.ingredient as any).currentStock ?? 0).toFixed(1)}</span>}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number" step="0.001" min="0"
                          placeholder="Qty"
                          value={receiveQtys[item.id] ?? ''}
                          onChange={(e) => setReceiveQtys((q) => ({ ...q, [item.id]: e.target.value }))}
                          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number" step="0.01" min="0"
                          placeholder={`${(Number(item.unitCost) / 100).toFixed(2)}`}
                          value={receivePrices[item.id] ?? ''}
                          onChange={(e) => setReceivePrices((p) => ({ ...p, [item.id]: e.target.value }))}
                          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-white font-body text-sm">{rqty > 0 ? `৳${lineTotal.toFixed(2)}` : '—'}</span>
                      </div>
                      <div className="col-span-2 text-[#666] font-body text-xs">{poUnit(item.ingredient, (item as any).unit)}</div>
                    </div>
                  );
                })}
                <div className="flex flex-col gap-1 mt-2">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                  <input
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                    placeholder="Delivery note, batch number, etc."
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              </div>
              {receiveMutation.error && (
                <p className="text-[#F03535] text-xs font-body mt-2">{(receiveMutation.error as Error).message}</p>
              )}
              {receiveMutation.isSuccess && (
                <p className="text-[#4CAF50] text-xs font-body mt-2">Stock updated successfully!</p>
              )}
              <button
                onClick={handleReceive}
                disabled={receiveMutation.isPending}
                className="mt-4 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-6 py-3 transition-colors disabled:opacity-50"
              >
                {receiveMutation.isPending ? 'Processing…' : 'Confirm Receipt'}
              </button>
            </div>
          )}

          {/* Return Goods Form */}
          {showReturnForm && (
            <div className="bg-[#161616] border border-[#2A2A2A] p-6 max-h-[60vh] overflow-auto">
              <h3 className="font-display text-lg text-white tracking-widest mb-4 sticky top-0 bg-[#161616] pb-2 z-10">RETURN GOODS</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3 items-center mb-2">
                  <div className="col-span-4 text-[#666] text-xs font-body tracking-widest uppercase">Item</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Qty</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Unit Price (৳)</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase text-right">Total</div>
                  <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Unit</div>
                </div>
                {returnLines.map((line, idx) => {
                  const qty = parseFloat(line.quantity) || 0;
                  const price = parseFloat(line.unitPrice) || 0;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-4">
                        <p className="text-white font-body text-sm">{line.name}</p>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number" step="0.001" min="0"
                          value={line.quantity}
                          onChange={(e) => setReturnLines((l) => l.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))}
                          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number" step="0.01" min="0"
                          value={line.unitPrice}
                          onChange={(e) => setReturnLines((l) => l.map((r, i) => i === idx ? { ...r, unitPrice: e.target.value } : r))}
                          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-white font-body text-sm">{qty > 0 ? `৳${(qty * price).toFixed(2)}` : '—'}</span>
                      </div>
                      <div className="col-span-2 text-[#666] font-body text-xs">{line.unit}</div>
                    </div>
                  );
                })}
                <div className="flex flex-col gap-1 mt-2">
                  <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                  <input
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Reason for return"
                    className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B] transition-colors"
                  />
                </div>
              </div>
              {returnError && (
                <p className="text-[#FFA726] text-xs font-body mt-2">{returnError}</p>
              )}
              {returnMutation.error && (
                <p className="text-[#F03535] text-xs font-body mt-2">{(returnMutation.error as Error).message}</p>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setShowReturnForm(false)}
                  className="bg-[#2A2A2A] hover:bg-[#1F1F1F] text-[#999] font-body text-sm px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateReturn}
                  disabled={returnMutation.isPending}
                  className="bg-[#FFA726] hover:bg-[#FFB74D] text-[#0D0D0D] font-body font-medium text-sm px-6 py-3 transition-colors disabled:opacity-50"
                >
                  {returnMutation.isPending ? 'Submitting…' : 'Submit Return'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Returns List View */}
      {view === 'returns' && (
        <div className="space-y-4">
          <h2 className="font-display text-xl text-white tracking-widest">PURCHASE RETURNS</h2>
          <div className="bg-[#161616] border border-[#2A2A2A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2A2A2A]">
                  {['Return #', 'Supplier', 'Items', 'Total', 'Status', 'Date', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[#666] font-body text-xs tracking-widest uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {returns.map((ret) => {
                  const total = ret.items.reduce((s, i) => s + (Number(i.unitPrice) / 100) * Number(i.quantity), 0);
                  return (
                    <tr key={ret.id} className="border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F]">
                      <td className="px-4 py-3 font-mono text-white text-xs">{ret.id.slice(-8).toUpperCase()}</td>
                      <td className="px-4 py-3 text-white font-body text-sm">{ret.supplier?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[#999] font-body text-sm">{ret.items.length}</td>
                      <td className="px-4 py-3 text-[#FFA726] font-body text-sm">৳{total.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-body px-2 py-0.5 ${RETURN_STATUS_COLORS[ret.status] ?? ''}`}>{ret.status}</span>
                      </td>
                      <td className="px-4 py-3 text-[#666] font-body text-xs">{new Date(ret.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 flex gap-2">
                        {(ret.status === 'REQUESTED' || ret.status === 'APPROVED') && (
                          <button
                            onClick={() => completeReturnMutation.mutate(ret.id)}
                            disabled={completeReturnMutation.isPending}
                            className="text-[#4CAF50] hover:text-[#66BB6A] font-body text-xs tracking-widest uppercase transition-colors"
                          >
                            Complete
                          </button>
                        )}
                        <button
                          onClick={() => printReturn(ret)}
                          className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase transition-colors"
                        >
                          Print
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {returns.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[#666] font-body text-sm">No returns yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Independent Return to Supplier */}
      {view === 'return-create' && (
        <div className="max-w-3xl space-y-6">
          <div className="bg-[#161616] border border-[#2A2A2A] p-6 space-y-4">
            <h2 className="font-display text-xl text-white tracking-widest mb-4">RETURN INGREDIENTS TO SUPPLIER</h2>
            <p className="text-[#666] font-body text-xs">Return inventory items to a supplier without a linked purchase order.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Supplier *</label>
                <select
                  value={indReturnSupplierId}
                  onChange={(e) => setIndReturnSupplierId(e.target.value)}
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                >
                  <option value="">— Select Supplier —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Notes</label>
                <input
                  value={indReturnNotes}
                  onChange={(e) => setIndReturnNotes(e.target.value)}
                  placeholder="Reason for return…"
                  className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#161616] border border-[#2A2A2A] p-6">
            <h3 className="font-display text-lg text-white tracking-widest mb-4">RETURN ITEMS</h3>
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-5 text-[#666] text-xs font-body tracking-widest uppercase">Ingredient (search)</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Qty</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase">Price (৳)</div>
              <div className="col-span-2 text-[#666] text-xs font-body tracking-widest uppercase text-right">Total</div>
              <div className="col-span-1"></div>
            </div>
            {indReturnLines.map((line, idx) => {
              const selIng = ingredients.find((i) => i.id === line.ingredientId);
              const qty = parseFloat(line.quantity) || 0;
              const price = parseFloat(line.unitPrice) || 0;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center mb-2">
                  <div className="col-span-5">
                    <input
                      list={`ret-ing-${idx}`}
                      value={indReturnSearch[idx] !== undefined ? indReturnSearch[idx] : (selIng ? `${selIng.name} (${selIng.unit})` : '')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIndReturnSearch((s) => ({ ...s, [idx]: val }));
                        const match = ingredients.find((i) => `${i.name} (${i.purchaseUnit || i.unit})` === val || `${i.name} (${i.unit})` === val || (i.itemCode ?? '') === val);
                        if (match) {
                          setIndReturnLines((l) => l.map((item, i) => i === idx ? { ...item, ingredientId: match.id, unitPrice: String((Number(match.costPerUnit) / 100).toFixed(2)) } : item));
                          setIndReturnSearch((s) => { const next = { ...s }; delete next[idx]; return next; });
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="Type name or code…"
                      className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
                    />
                    <datalist id={`ret-ing-${idx}`}>
                      {ingredients.filter((i) => {
                        const s = (indReturnSearch[idx] ?? '').toLowerCase().trim();
                        return !s || i.name.toLowerCase().includes(s) || (i.itemCode ?? '').toLowerCase().includes(s);
                      }).slice(0, 30).map((i) => (
                        <option key={i.id} value={`${i.name} (${i.purchaseUnit || i.unit})`}>{i.itemCode ? `[${i.itemCode}] ` : ''}{i.name} {i.purchaseUnit ? `[${i.purchaseUnit}]` : ''} — Stock: {Number(i.currentStock).toFixed(1)} {i.unit}</option>
                      ))}
                    </datalist>
                  </div>
                  <div className="col-span-2">
                    <input type="number" step="0.001" min="0" value={line.quantity} onChange={(e) => setIndReturnLines((l) => l.map((item, i) => i === idx ? { ...item, quantity: e.target.value } : item))} className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" step="0.01" min="0" value={line.unitPrice} onChange={(e) => setIndReturnLines((l) => l.map((item, i) => i === idx ? { ...item, unitPrice: e.target.value } : item))} placeholder="৳" className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-white font-body text-sm">{qty > 0 && price > 0 ? `৳${(qty * price).toFixed(2)}` : '—'}</span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => { setIndReturnLines((l) => l.filter((_, i) => i !== idx)); setIndReturnSearch((s) => { const next = { ...s }; delete next[idx]; return next; }); }} className="text-[#666] hover:text-[#D62B2B] text-xs transition-colors">✕</button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => setIndReturnLines((l) => [...l, { ingredientId: '', quantity: '0', unitPrice: '0' }])}
              className="mt-2 text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors border border-dashed border-[#2A2A2A] hover:border-[#D62B2B] w-full py-2"
            >
              + Add Item
            </button>

            {/* Grand Total */}
            {indReturnLines.some((l) => parseFloat(l.quantity) > 0) && (
              <div className="mt-4 pt-4 border-t border-[#2A2A2A] flex justify-between items-center">
                <span className="font-display text-lg text-white tracking-widest">RETURN TOTAL</span>
                <span className="font-display text-2xl text-[#FFA726]">
                  ৳{indReturnLines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {indReturnMutation.error && (
            <p className="text-[#F03535] text-xs font-body">{(indReturnMutation.error as Error).message}</p>
          )}
          <button
            onClick={() => indReturnMutation.mutate()}
            disabled={!indReturnSupplierId || indReturnLines.filter((l) => l.ingredientId && parseFloat(l.quantity) > 0).length === 0 || indReturnMutation.isPending}
            className="bg-[#FFA726] hover:bg-[#FFB74D] text-[#0D0D0D] font-body font-medium text-sm px-6 py-3 transition-colors disabled:opacity-50"
          >
            {indReturnMutation.isPending ? 'Submitting…' : 'Submit Return Request'}
          </button>
        </div>
      )}
    </div>
  );
}
