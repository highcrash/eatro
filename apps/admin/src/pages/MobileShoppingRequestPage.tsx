import { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, X, Camera, Trash2, AlertTriangle, Loader2 } from 'lucide-react';

import { api } from '../lib/api';
import type {
  CreateShoppingRequestDto,
  Ingredient,
  MismatchReason,
  ShoppingRequest,
} from '@restora/types';
import { OVERAGE_REASONS, SHORTAGE_REASONS } from '@restora/types';

/**
 * Mobile-first shopping-request builder. Designed for a phone browser
 * pointed at the admin URL — any roomed staff member with role
 * KITCHEN / ADVISOR / MANAGER / OWNER can submit a request.
 *
 * Each row is a card. Tap "+ Stock mismatch?" to reveal a physical-
 * count input + reason picker (shortage vs overage tracks shown
 * conditionally on the sign of the delta). When the reason is WASTE
 * a "Capture photo" button uploads to the existing /upload/image
 * endpoint and stores the returned URL on the line state — admin
 * sees the thumbnail at review time.
 *
 * Submission posts to POST /shopping-requests. Nothing in inventory
 * moves yet — admin reviews on desktop, picks supplier per line,
 * and approves.
 */

/** Mismatch state for one variant (or for a standalone — modeled as
 *  a single-variant "family" for uniform rendering). */
type VariantMismatchDraft = {
  variantId: string;
  /** Display label inside the mismatch section ("Pushti Packet KG"),
   *  or '' for a standalone. */
  label: string;
  /** The variant's own currentStock at the moment the row was added. */
  currentStock: number;
  physicalCount: string;
  mismatchReason: MismatchReason | null;
  mismatchPhotoUrl: string | null;
  mismatchNotes: string;
};

type LineDraft = {
  /** Stable client-side id so React keys survive reorder. Server doesn't see it. */
  key: string;
  /** Variant ingredient the staff picked from the search — this is the
   *  one the "order qty" line targets so admin's review knows exactly
   *  which brand to reorder. */
  pickedVariantId: string;
  /** Parent ingredient id (same as pickedVariantId for standalones). */
  parentId: string;
  /** Display name combining parent + variant brand (e.g.
   *  "Pulao Rice PACK — Pushti Packet KG"). */
  pickedLabel: string;
  /** Parent name only ("Pulao Rice PACK") — used in the mismatch
   *  expander when listing siblings. */
  parentName: string;
  unit: string;
  purchaseUnit: string | null;
  /** Aggregate across all variants of the parent family (or the
   *  standalone's own stock). Shown next to the per-variant stock so
   *  staff sees both numbers at a glance. */
  totalStock: number;
  /** Order-qty input — targets the picked variant. Admin can change
   *  supplier per line at review time. */
  requestedQuantity: string;
  showMismatch: boolean;
  /** One entry per variant in the parent family (including the picked
   *  one). Single entry for standalones. Each carries its own
   *  physical count + reason + photo so the kitchen can reconcile
   *  every brand of the same staple in one row. */
  variants: VariantMismatchDraft[];
};

const REASON_LABEL: Record<MismatchReason, string> = {
  WASTE: 'Waste',
  MISCALCULATION: 'Miscalculation',
  MISSING_PURCHASE: 'Missing purchase',
  ADJUSTMENT: 'Adjustment',
};

const REASON_DESC: Record<MismatchReason, string> = {
  WASTE: 'Spoiled, dropped, used unrecorded',
  MISCALCULATION: 'Counted wrong / shrinkage',
  MISSING_PURCHASE: 'Stock arrived without a PO',
  ADJUSTMENT: 'Donated, transferred in, etc.',
};

export default function MobileShoppingRequestPage() {
  const qc = useQueryClient();

  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients-for-shopping'],
    queryFn: () => api.get<Ingredient[]>('/ingredients'),
  });

  // Flatten parents + variants into a single picker list so staff can
  // pick a specific brand variant directly when relevant. Each row
  // carries `parentId` + the per-variant + aggregate stock so the
  // mismatch expander can fan out across siblings without an extra
  // lookup at add time.
  type PickerOption = {
    id: string;
    label: string;
    parentId: string;
    parentName: string;
    unit: string;
    purchaseUnit: string | null;
    currentStock: number;
    /** Sum across the parent's whole family — equals currentStock for
     *  standalones. Drives the "Total: NN G" badge on the line card. */
    totalStock: number;
    /** All siblings under the same parent (including the picked one)
     *  with their own stock + brand label, in createdAt order. Empty
     *  for standalones (a single-entry family is built at add time). */
    siblings: Array<{ variantId: string; label: string; currentStock: number }>;
  };
  const pickerOptions = useMemo<PickerOption[]>(() => {
    const rows: PickerOption[] = [];
    for (const ing of ingredients) {
      if (ing.hasVariants) {
        const variants = (ing as Ingredient & { variants?: Ingredient[] }).variants ?? [];
        const totalStock = variants.reduce((s, v) => s + Number(v.currentStock), 0);
        const siblings = variants.map((v) => ({
          variantId: v.id,
          label: v.brandName ?? v.name,
          currentStock: Number(v.currentStock),
        }));
        for (const v of variants) {
          rows.push({
            id: v.id,
            label: `${ing.name} — ${v.brandName ?? v.name}`,
            parentId: ing.id,
            parentName: ing.name,
            unit: v.unit,
            purchaseUnit: v.purchaseUnit ?? ing.purchaseUnit ?? null,
            currentStock: Number(v.currentStock),
            totalStock,
            siblings,
          });
        }
      } else if (!ing.parentId) {
        rows.push({
          id: ing.id,
          label: ing.name,
          parentId: ing.id,
          parentName: ing.name,
          unit: ing.unit,
          purchaseUnit: ing.purchaseUnit ?? null,
          currentStock: Number(ing.currentStock),
          totalStock: Number(ing.currentStock),
          siblings: [],
        });
      }
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [ingredients]);

  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const filteredPicker = useMemo(() => {
    if (!query.trim()) return pickerOptions.slice(0, 25);
    const q = query.trim().toLowerCase();
    return pickerOptions.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 50);
  }, [pickerOptions, query]);

  const addLine = (opt: PickerOption) => {
    // Dedup at the parent level — if any variant of this parent is
    // already on the list, focus that row instead of adding a duplicate
    // (the mismatch expander already covers every sibling).
    const existing = lines.find((l) => l.parentId === opt.parentId);
    if (existing) {
      const el = document.getElementById(`line-${existing.parentId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Build the per-variant mismatch slots up front. Standalones get a
    // single-entry list so the rendering path stays uniform.
    const variantSlots: VariantMismatchDraft[] = opt.siblings.length > 0
      ? opt.siblings.map((s) => ({
          variantId: s.variantId,
          label: s.label,
          currentStock: s.currentStock,
          physicalCount: '',
          mismatchReason: null,
          mismatchPhotoUrl: null,
          mismatchNotes: '',
        }))
      : [{
          variantId: opt.id,
          label: '',
          currentStock: opt.currentStock,
          physicalCount: '',
          mismatchReason: null,
          mismatchPhotoUrl: null,
          mismatchNotes: '',
        }];
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        pickedVariantId: opt.id,
        parentId: opt.parentId,
        pickedLabel: opt.label,
        parentName: opt.parentName,
        unit: opt.unit,
        purchaseUnit: opt.purchaseUnit,
        totalStock: opt.totalStock,
        requestedQuantity: '',
        showMismatch: false,
        variants: variantSlots,
      },
    ]);
    setQuery('');
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const updateVariant = (lineKey: string, variantId: string, patch: Partial<VariantMismatchDraft>) => {
    setLines((prev) =>
      prev.map((l) =>
        l.key !== lineKey
          ? l
          : { ...l, variants: l.variants.map((v) => (v.variantId === variantId ? { ...v, ...patch } : v)) },
      ),
    );
  };
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const submitMut = useMutation({
    mutationFn: (dto: CreateShoppingRequestDto) =>
      api.post<ShoppingRequest>('/shopping-requests', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-requests'] });
      qc.invalidateQueries({ queryKey: ['shopping-requests-mine'] });
      setLines([]);
      setNotes('');
      setSubmitError(null);
    },
    onError: (e: unknown) => {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed');
    },
  });

  const hasSubmittable = lines.some((l) => {
    const qty = parseFloat(l.requestedQuantity);
    const hasQty = !Number.isNaN(qty) && qty > 0;
    const hasAnyMismatch = l.variants.some((v) => {
      const p = parseFloat(v.physicalCount);
      return v.mismatchReason != null && !Number.isNaN(p) && p >= 0;
    });
    return hasQty || hasAnyMismatch;
  });

  const handleSubmit = () => {
    setSubmitError(null);
    const payload: CreateShoppingRequestDto['lines'] = [];
    for (const l of lines) {
      const qty = parseFloat(l.requestedQuantity);
      const hasQty = !Number.isNaN(qty) && qty > 0;

      // Pick up every per-variant mismatch entry the staff filled in.
      const mismatchEntries = l.variants
        .map((v) => {
          const physical = parseFloat(v.physicalCount);
          const hasPhysical = !Number.isNaN(physical) && physical >= 0;
          if (!hasPhysical || v.mismatchReason == null) return null;
          return {
            variantId: v.variantId,
            physical,
            reason: v.mismatchReason,
            photoUrl: v.mismatchReason === 'WASTE' ? v.mismatchPhotoUrl : null,
            notes: v.mismatchNotes.trim() || null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // The order-qty row targets the variant the staff picked. If the
      // picked variant ALSO has a mismatch entry, fold it into the same
      // line so the server gets one row per (ingredient, intent) pair
      // instead of two for the same ingredient.
      if (hasQty) {
        const sameVariantMismatch = mismatchEntries.find((m) => m.variantId === l.pickedVariantId);
        payload.push({
          ingredientId: l.pickedVariantId,
          requestedQuantity: qty,
          physicalCount: sameVariantMismatch ? sameVariantMismatch.physical : null,
          mismatchReason: sameVariantMismatch ? sameVariantMismatch.reason : null,
          mismatchPhotoUrl: sameVariantMismatch ? sameVariantMismatch.photoUrl : null,
          mismatchNotes: sameVariantMismatch ? sameVariantMismatch.notes : null,
        });
      }

      // Every other variant with a mismatch becomes its own line.
      for (const m of mismatchEntries) {
        if (hasQty && m.variantId === l.pickedVariantId) continue;
        payload.push({
          ingredientId: m.variantId,
          requestedQuantity: null,
          physicalCount: m.physical,
          mismatchReason: m.reason,
          mismatchPhotoUrl: m.photoUrl,
          mismatchNotes: m.notes,
        });
      }
    }

    if (payload.length === 0) {
      setSubmitError('Add a quantity to order or flag a mismatch on at least one line.');
      return;
    }
    submitMut.mutate({ notes: notes.trim() || null, lines: payload });
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white pb-32">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-[#0D0D0D]/95 backdrop-blur border-b border-[#2A2A2A] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl tracking-widest">SHOPPING REQUEST</h1>
          <p className="text-[10px] text-[#888] uppercase tracking-widest">Submit to admin</p>
        </div>
        <Link to="/mobile/shopping/history" className="text-xs text-[#D62B2B] hover:text-white tracking-widest uppercase">
          History →
        </Link>
      </header>

      {/* Ingredient picker (sticky right under header) */}
      <div className="sticky top-[62px] z-20 bg-[#0D0D0D]/95 backdrop-blur border-b border-[#2A2A2A] px-4 py-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ingredient…"
            className="w-full bg-[#161616] border border-[#2A2A2A] text-white pl-9 pr-3 py-3 text-sm outline-none focus:border-[#D62B2B]"
          />
        </div>
        {query.trim() && (
          <div className="mt-2 border border-[#2A2A2A] bg-[#161616] max-h-64 overflow-y-auto">
            {filteredPicker.length === 0 ? (
              <p className="text-[#666] text-xs px-3 py-3">No matches.</p>
            ) : (
              filteredPicker.map((o) => (
                <button
                  key={o.id}
                  onClick={() => addLine(o)}
                  className="w-full text-left px-3 py-3 text-sm border-b border-[#2A2A2A] last:border-0 hover:bg-[#1F1F1F] active:bg-[#222]"
                >
                  <div className="text-white">{o.label}</div>
                  <div className="text-[10px] text-[#888]">Stock {o.currentStock.toFixed(2)} {o.unit}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Lines */}
      <main className="px-4 py-3 space-y-3">
        {lines.length === 0 && (
          <div className="text-center text-[#666] text-sm py-12">
            Search and tap an ingredient above to add it to your request.
          </div>
        )}
        {lines.map((line) => (
          <LineCard
            key={line.key}
            line={line}
            onChange={(patch) => updateLine(line.key, patch)}
            onVariantChange={(variantId, patch) => updateVariant(line.key, variantId, patch)}
            onRemove={() => removeLine(line.key)}
          />
        ))}

        {lines.length > 0 && (
          <>
            <div>
              <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything admin should know about this list…"
                rows={3}
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B] resize-none"
              />
            </div>

            {submitError && (
              <div className="bg-[#3a1a1a] border border-[#D62B2B] text-[#F03535] p-3 text-sm flex items-center justify-between">
                <span>{submitError}</span>
                <button onClick={() => setSubmitError(null)} className="text-[#666] hover:text-white">
                  <X size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Sticky submit bar */}
      {lines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#0D0D0D] border-t border-[#2A2A2A] px-4 py-3">
          <button
            onClick={handleSubmit}
            disabled={!hasSubmittable || submitMut.isPending}
            className="w-full bg-[#D62B2B] hover:bg-[#F03535] disabled:bg-[#3a1a1a] disabled:text-[#666] text-white font-body text-sm py-3 tracking-widest uppercase transition-colors flex items-center justify-center gap-2"
          >
            {submitMut.isPending && <Loader2 size={14} className="animate-spin" />}
            {submitMut.isPending ? 'Submitting…' : 'Submit to admin'}
          </button>
        </div>
      )}

      {submitMut.isSuccess && (
        <div className="fixed top-4 left-4 right-4 z-40 bg-[#1a3a1a] border border-[#4CAF50] text-[#4CAF50] p-3 text-sm flex items-center justify-between">
          <span>Request submitted! Admin will review.</span>
          <Link to="/mobile/shopping/history" className="underline">View history</Link>
        </div>
      )}
    </div>
  );
}

function LineCard({ line, onChange, onVariantChange, onRemove }: {
  line: LineDraft;
  onChange: (patch: Partial<LineDraft>) => void;
  onVariantChange: (variantId: string, patch: Partial<VariantMismatchDraft>) => void;
  onRemove: () => void;
}) {
  const isFamily = line.variants.length > 1;
  const pickedVariant = line.variants.find((v) => v.variantId === line.pickedVariantId);
  const pickedStock = pickedVariant?.currentStock ?? line.totalStock;

  const cancelMismatch = () => {
    onChange({
      showMismatch: false,
      variants: line.variants.map((v) => ({
        ...v, physicalCount: '', mismatchReason: null, mismatchPhotoUrl: null, mismatchNotes: '',
      })),
    });
  };

  return (
    <div id={`line-${line.parentId}`} className="bg-[#161616] border border-[#2A2A2A] p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{line.pickedLabel}</p>
          <p className="text-[10px] text-[#888]">
            Software: {pickedStock.toFixed(2)} {line.unit}
            {isFamily && (
              <span className="text-[#FFA726]"> · Total: {line.totalStock.toFixed(2)} {line.unit} across {line.variants.length} variants</span>
            )}
          </p>
        </div>
        <button onClick={onRemove} className="text-[#666] hover:text-[#D62B2B] p-1 -m-1">
          <Trash2 size={16} />
        </button>
      </div>

      <div>
        <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">
          Order qty ({line.purchaseUnit ?? line.unit})
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={line.requestedQuantity}
          onChange={(e) => onChange({ requestedQuantity: e.target.value })}
          placeholder="0"
          className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm outline-none focus:border-[#D62B2B]"
        />
      </div>

      {!line.showMismatch ? (
        <button
          onClick={() => onChange({ showMismatch: true })}
          className="text-[10px] tracking-widest uppercase text-[#FFA726] hover:text-white py-1"
        >
          + Stock mismatch?
        </button>
      ) : (
        <div className="border-t border-[#2A2A2A] pt-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-widest uppercase text-[#FFA726] flex items-center gap-1">
              <AlertTriangle size={12} /> Mismatch{isFamily && ` · per variant`}
            </span>
            <button onClick={cancelMismatch} className="text-[10px] text-[#666] hover:text-white">
              Cancel
            </button>
          </div>

          {line.variants.map((variant) => (
            <VariantMismatchEditor
              key={variant.variantId}
              variant={variant}
              unit={line.unit}
              showLabel={isFamily}
              onChange={(patch) => onVariantChange(variant.variantId, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-variant mismatch sub-card. When the line is a single-variant
 *  family (standalone), `showLabel` is false and we render the inputs
 *  flush with the parent card. For a multi-variant family every
 *  sibling gets its own collapsible-style row with the brand name. */
function VariantMismatchEditor({ variant, unit, showLabel, onChange }: {
  variant: VariantMismatchDraft;
  unit: string;
  showLabel: boolean;
  onChange: (patch: Partial<VariantMismatchDraft>) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const physical = parseFloat(variant.physicalCount);
  const hasPhysical = !Number.isNaN(physical) && physical >= 0;
  const delta = hasPhysical ? physical - variant.currentStock : 0;
  const reasonOptions: MismatchReason[] =
    !hasPhysical || Math.abs(delta) < 0.0001
      ? []
      : delta < 0 ? SHORTAGE_REASONS : OVERAGE_REASONS;

  const handlePhoto = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ url: string }>('/upload/image', file);
      onChange({ mismatchPhotoUrl: res.url });
    } catch (e) {
      alert(`Photo upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={showLabel ? 'bg-[#0D0D0D] border border-[#2A2A2A] p-2.5 space-y-2' : 'space-y-2'}>
      {showLabel && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white">{variant.label}</p>
          <p className="text-[10px] text-[#888]">Software: {variant.currentStock.toFixed(2)} {unit}</p>
        </div>
      )}

      <div>
        <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">
          Physical count ({unit})
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={variant.physicalCount}
          onChange={(e) => onChange({ physicalCount: e.target.value })}
          placeholder="Type what you counted"
          className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm outline-none focus:border-[#D62B2B]"
        />
      </div>

      {hasPhysical && (
        <div className="text-xs">
          {Math.abs(delta) < 0.0001 ? (
            <span className="text-[#888]">Counts match — no mismatch.</span>
          ) : delta < 0 ? (
            <span className="text-[#D62B2B]">Short by {Math.abs(delta).toFixed(2)} {unit}</span>
          ) : (
            <span className="text-[#4CAF50]">Over by {delta.toFixed(2)} {unit}</span>
          )}
        </div>
      )}

      {reasonOptions.length > 0 && (
        <div>
          <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">Reason</label>
          <div className="grid grid-cols-2 gap-2">
            {reasonOptions.map((r) => (
              <button
                key={r}
                onClick={() => onChange({ mismatchReason: r, mismatchPhotoUrl: r === 'WASTE' ? variant.mismatchPhotoUrl : null })}
                className={`text-xs py-2 px-2 border transition-colors ${
                  variant.mismatchReason === r
                    ? 'bg-[#D62B2B] border-[#D62B2B] text-white'
                    : 'bg-[#161616] border-[#2A2A2A] text-[#999] hover:border-[#D62B2B]'
                }`}
              >
                <div className="font-bold">{REASON_LABEL[r]}</div>
                <div className="text-[9px] text-[#666] mt-0.5">{REASON_DESC[r]}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {variant.mismatchReason === 'WASTE' && (
        <div>
          <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">Photo (optional)</label>
          {variant.mismatchPhotoUrl ? (
            <div className="relative inline-block">
              <img src={variant.mismatchPhotoUrl} alt="Waste" className="h-20 w-20 object-cover border border-[#2A2A2A]" />
              <button
                onClick={() => onChange({ mismatchPhotoUrl: null })}
                className="absolute -top-2 -right-2 bg-[#D62B2B] text-white rounded-full w-5 h-5 flex items-center justify-center"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 bg-[#161616] border border-[#2A2A2A] text-[#999] hover:border-[#D62B2B] text-xs px-3 py-2"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
              {uploading ? 'Uploading…' : 'Capture photo'}
            </button>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {variant.mismatchReason && (
        <div>
          <label className="block text-[10px] tracking-widest uppercase text-[#888] mb-1">Notes (optional)</label>
          <textarea
            value={variant.mismatchNotes}
            onChange={(e) => onChange({ mismatchNotes: e.target.value })}
            rows={2}
            className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-3 py-2 text-sm outline-none focus:border-[#D62B2B] resize-none"
          />
        </div>
      )}
    </div>
  );
}
