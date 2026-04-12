/**
 * VariantPickerModal — When a user selects a parent ingredient (hasVariants),
 * this modal pops up showing all variants so they can pick the specific brand.
 * Includes a "Quick Add Variant" button that opens VariantDialog inline.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Ingredient } from '@restora/types';
import VariantDialog from './VariantDialog';

interface Props {
  parent: Ingredient;
  onSelect: (variant: Ingredient) => void;
  onClose: () => void;
}

export default function VariantPickerModal({ parent, onSelect, onClose }: Props) {
  const qc = useQueryClient();
  const { data: liveVariants } = useQuery<Ingredient[]>({
    queryKey: ['variants', parent.id],
    queryFn: () => api.get(`/ingredients/${parent.id}/variants`),
  });
  const variants = (liveVariants ?? parent.variants ?? []).filter((v: any) => v.isActive !== false);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-[#FFA726] text-[10px] font-body font-medium tracking-widest uppercase">Select Variant</p>
          <h2 className="font-display text-xl text-white tracking-widest">{parent.name}</h2>
          <p className="text-[#666] text-xs font-body mt-1">
            Unit: {parent.unit}{parent.purchaseUnit ? ` · Purchase: ${parent.purchaseUnit}` : ''} · {variants.length} variant{variants.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="p-4 space-y-2 max-h-[60vh] overflow-auto">
          {variants.length === 0 && (
            <p className="text-[#666] text-sm font-body text-center py-4">No variants yet.</p>
          )}
          {variants.map((v) => (
            <button
              key={v.id}
              onClick={() => onSelect(v)}
              className="w-full text-left bg-[#0D0D0D] border border-[#2A2A2A] hover:border-[#FFA726] p-3 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[#FFA726] font-body text-sm font-semibold">{v.brandName}</span>
                  {v.packSize && <span className="text-[#666] font-body text-xs ml-2">{v.packSize}</span>}
                  {v.piecesPerPack && <span className="text-[#666] font-body text-xs ml-1">({v.piecesPerPack} {parent.unit}/{parent.purchaseUnit || 'PACK'})</span>}
                </div>
                <div className="text-right">
                  <span className={`font-body text-sm font-medium ${Number(v.currentStock) <= Number(v.minimumStock) ? 'text-[#D62B2B]' : 'text-white'}`}>
                    {Number(v.currentStock).toFixed(2)} {v.unit}
                  </span>
                  {Number(v.costPerUnit) > 0 && (
                    <span className="text-[#666] font-body text-[10px] block">
                      ৳{(Number(v.costPerUnit) / 100).toFixed(2)}/{v.unit}
                      {Number(v.costPerPurchaseUnit) > 0 && ` · ৳${(Number(v.costPerPurchaseUnit) / 100).toFixed(2)}/${parent.purchaseUnit || 'PACK'}`}
                    </span>
                  )}
                </div>
              </div>
              {v.sku && <span className="text-[#555] font-mono text-[10px]">SKU: {v.sku}</span>}
              {v.supplier && <span className="text-[#555] font-body text-[10px] ml-2">Supplier: {v.supplier.name}</span>}
            </button>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-[#2A2A2A] flex justify-between">
          <button onClick={() => setShowAdd(true)} className="text-[#FFA726] hover:text-white font-body text-xs tracking-widest uppercase transition-colors px-4 py-2">
            + Quick Add Variant
          </button>
          <button onClick={onClose} className="text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors px-4 py-2">Cancel</button>
        </div>
      </div>
    </div>

    {showAdd && (
      <VariantDialog parent={parent} onClose={() => { setShowAdd(false); void qc.invalidateQueries({ queryKey: ['variants', parent.id] }); }} />
    )}
    </>
  );
}
