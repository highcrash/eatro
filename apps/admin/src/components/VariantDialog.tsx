/**
 * VariantDialog — Modal for Add/Edit variant on a parent ingredient.
 * Supports multiple suppliers via checkboxes (same pattern as parent ingredient form).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Ingredient, Supplier } from '@restora/types';

interface Props {
  parent: Ingredient;
  variant?: Ingredient; // if set, we're editing
  onClose: () => void;
}

export default function VariantDialog({ parent, variant, onClose }: Props) {
  const qc = useQueryClient();
  const isEdit = !!variant;

  const [brandName, setBrandName] = useState(variant?.brandName ?? '');
  const [packSize, setPackSize] = useState(variant?.packSize ?? '');
  const [piecesPerPack, setPiecesPerPack] = useState(String(variant?.piecesPerPack ?? ''));
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [costPerPurchaseUnit, setCostPerPurchaseUnit] = useState(
    variant ? String(Number(variant.costPerPurchaseUnit) / 100) : '0',
  );
  // Min stock is tracked on the parent only, not per variant
  const [supplierIds, setSupplierIds] = useState<string[]>(
    variant?.suppliers?.map((s) => s.supplierId) ?? (variant?.supplierId ? [variant.supplierId] : []),
  );

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    select: (d) => d.filter((s) => s.isActive),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const result = await api.post<Ingredient>(`/ingredients/${parent.id}/variants`, {
        brandName,
        packSize: packSize || undefined,
        piecesPerPack: piecesPerPack ? parseInt(piecesPerPack) : undefined,
        sku: sku || undefined,
        costPerPurchaseUnit: costPerPurchaseUnit ? Math.round(parseFloat(costPerPurchaseUnit) * 100) : undefined,
        supplierId: supplierIds[0] || undefined,
      });
      // Set multiple suppliers
      if (supplierIds.length > 0 && (result as any).id) {
        await api.put(`/ingredients/${(result as any).id}/suppliers`, { supplierIds });
      }
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      onClose();
    },
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      await api.patch(`/ingredients/${variant!.id}`, {
        name: `${parent.name} — ${brandName}`,
        costPerPurchaseUnit: Math.round((parseFloat(costPerPurchaseUnit) || 0) * 100),
        purchaseUnitQty: piecesPerPack ? parseInt(piecesPerPack) : undefined,
      });
      // Update variant-specific fields via a separate endpoint or direct patch
      // brandName, packSize, piecesPerPack, sku are on the Ingredient model
      await api.patch(`/ingredients/${variant!.id}`, {
        brandName,
        packSize: packSize || null,
        piecesPerPack: piecesPerPack ? parseInt(piecesPerPack) : null,
        sku: sku || null,
      });
      if (supplierIds.length > 0) {
        await api.put(`/ingredients/${variant!.id}/suppliers`, { supplierIds });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      onClose();
    },
  });

  const isPending = createMut.isPending || updateMut.isPending;

  const toggleSupplier = (sid: string) => {
    setSupplierIds((prev) => prev.includes(sid) ? prev.filter((s) => s !== sid) : [...prev, sid]);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-[#FFA726] text-[10px] font-body font-medium tracking-widest uppercase">
            {isEdit ? 'Edit Variant' : 'Add Variant'}
          </p>
          <h2 className="font-display text-xl text-white tracking-widest">{parent.name}</h2>
          <p className="text-[#666] text-xs font-body mt-1">
            Unit: {parent.unit}{parent.purchaseUnit ? ` · Purchase: ${parent.purchaseUnit}` : ''}
          </p>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-auto">
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Brand Name *</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)}
              placeholder="e.g. Milk Butter, Bread Pit"
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726]" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Pack Weight</label>
              <input value={packSize} onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 250G, 1L"
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
                {parent.unit} per {parent.purchaseUnit || 'PACK'}
              </label>
              <input type="number" step="1" min="1" value={piecesPerPack} onChange={(e) => setPiecesPerPack(e.target.value)}
                placeholder="e.g. 10"
                className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726]" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">
              Cost per {parent.purchaseUnit || 'PACK'} (৳)
            </label>
            <input type="number" step="0.01" min="0" value={costPerPurchaseUnit} onChange={(e) => setCostPerPurchaseUnit(e.target.value)}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726]" />
            <p className="text-[#555] text-[10px] font-body">Low stock warning is based on the parent ingredient's min stock, not per variant.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">SKU / Barcode</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#FFA726]" />
          </div>

          {/* Cost calculation preview */}
          {piecesPerPack && parseFloat(piecesPerPack) > 0 && parseFloat(costPerPurchaseUnit) > 0 && (
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3">
              <p className="text-[#999] font-body text-xs">
                1 {parent.purchaseUnit || 'PACK'} = {piecesPerPack} {parent.unit} ·
                ৳{costPerPurchaseUnit}/{parent.purchaseUnit || 'PACK'} =
                <span className="text-[#FFA726] font-semibold ml-1">
                  ৳{(parseFloat(costPerPurchaseUnit) / parseFloat(piecesPerPack)).toFixed(2)}/{parent.unit}
                </span>
              </p>
            </div>
          )}

          {/* Suppliers */}
          <div className="flex flex-col gap-1">
            <label className="text-[#666] text-xs font-body font-medium tracking-widest uppercase">Suppliers</label>
            <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-2 max-h-32 overflow-auto space-y-1">
              {suppliers.map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-2 py-1 hover:bg-[#1A1A1A] cursor-pointer">
                  <input type="checkbox" checked={supplierIds.includes(s.id)} onChange={() => toggleSupplier(s.id)}
                    className="accent-[#FFA726]" />
                  <span className="text-white font-body text-xs">{s.name}</span>
                </label>
              ))}
              {suppliers.length === 0 && <p className="text-[#666] text-xs font-body p-2">No suppliers</p>}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#2A2A2A] flex gap-2 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="border border-[#2A2A2A] px-4 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
            Cancel
          </button>
          <button
            onClick={() => isEdit ? updateMut.mutate() : createMut.mutate()}
            disabled={!brandName.trim() || isPending}
            className="bg-[#FFA726] text-black px-5 py-2 text-sm font-body font-medium hover:bg-[#FFB74D] disabled:opacity-50 transition-colors">
            {isPending ? 'Saving…' : isEdit ? 'Update' : 'Add Variant'}
          </button>
        </div>
      </div>
    </div>
  );
}
