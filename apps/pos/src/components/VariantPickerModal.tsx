/**
 * VariantPickerModal for POS — includes Quick Add Variant inline form.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Ingredient } from '@restora/types';

interface Props {
  parent: Ingredient;
  onSelect: (variant: Ingredient) => void;
  onClose: () => void;
}

export default function VariantPickerModal({ parent, onSelect, onClose }: Props) {
  const qc = useQueryClient();
  // Fetch live variants so quick-add shows immediately
  const { data: liveVariants } = useQuery<Ingredient[]>({
    queryKey: ['variants', parent.id],
    queryFn: () => api.get(`/ingredients/${parent.id}/variants`),
  });
  const variants = (liveVariants ?? parent.variants ?? []).filter((v: any) => v.isActive !== false);
  const [showAdd, setShowAdd] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [packSize, setPackSize] = useState('');
  const [piecesPerPack, setPiecesPerPack] = useState('');

  const createMut = useMutation({
    mutationFn: () => api.post(`/ingredients/${parent.id}/variants`, {
      brandName,
      packSize: packSize || undefined,
      piecesPerPack: piecesPerPack ? parseInt(piecesPerPack) : undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ingredients'] });
      void qc.invalidateQueries({ queryKey: ['variants', parent.id] });
      setBrandName('');
      setPackSize('');
      setPiecesPerPack('');
      setShowAdd(false);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#2A2A2A]">
          <p className="text-theme-accent text-[10px] font-body font-medium tracking-widest uppercase">Select Variant</p>
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
              className="w-full text-left bg-[#0D0D0D] border border-[#2A2A2A] hover:border-theme-accent p-3 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-theme-accent font-body text-sm font-semibold">{v.brandName}</span>
                  {v.packSize && <span className="text-[#666] font-body text-xs ml-2">{v.packSize}</span>}
                  {v.piecesPerPack && <span className="text-[#666] font-body text-xs ml-1">({v.piecesPerPack} {parent.unit}/{parent.purchaseUnit || 'PACK'})</span>}
                </div>
                <span className={`font-body text-sm font-medium ${Number(v.minimumStock) > 0 && Number(v.currentStock) <= Number(v.minimumStock) ? 'text-red-500' : 'text-white'}`}>
                  {Number(v.currentStock).toFixed(2)} {v.unit}
                </span>
              </div>
            </button>
          ))}

          {/* Quick Add Variant */}
          {showAdd && (
            <div className="bg-[#0D0D0D] border border-theme-accent p-3 space-y-2">
              <p className="text-theme-accent text-[10px] font-body font-medium tracking-widest uppercase">Quick Add Variant</p>
              <div className="flex gap-2">
                <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Brand name *"
                  className="flex-1 bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs rounded-theme" />
                <input value={packSize} onChange={(e) => setPackSize(e.target.value)} placeholder="Pack size"
                  className="w-24 bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs rounded-theme" />
                <input value={piecesPerPack} onChange={(e) => setPiecesPerPack(e.target.value)} placeholder={`${parent.unit}/PACK`}
                  className="w-20 bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs rounded-theme" />
              </div>
              {createMut.isError && <p className="text-red-500 text-[10px]">{(createMut.error as Error).message}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="text-[#666] text-xs px-3 py-1">Cancel</button>
                <button onClick={() => createMut.mutate()} disabled={!brandName.trim() || createMut.isPending}
                  className="bg-theme-accent text-white px-3 py-1 text-xs font-bold rounded-theme disabled:opacity-50">
                  {createMut.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[#2A2A2A] flex justify-between">
          <button onClick={() => setShowAdd(true)} className="text-theme-accent hover:text-white font-body text-xs tracking-widest uppercase transition-colors px-4 py-2">
            + Quick Add Variant
          </button>
          <button onClick={onClose} className="text-[#666] hover:text-white font-body text-xs tracking-widest uppercase transition-colors px-4 py-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}
