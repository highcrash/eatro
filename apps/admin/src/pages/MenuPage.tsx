import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Package, Link2, Image, Upload } from 'lucide-react';

import type { MenuItem, MenuCategory, CreateMenuItemDto, LinkedItemType } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';
import { resizeImage } from '../lib/image-resize';

/** Resolve image path — uploaded files are served at /uploads/x.jpg (proxied to API in dev) */
function resolveImageUrl(url: string) {
  if (!url) return '';
  return url;
}

// ─── Emoji Icon Picker ───────────────────────────────────────────────────────

const EMOJI_LIST = [
  // Food
  '🍗', '🍕', '🍔', '🌮', '🍣', '🥘', '🍝', '🥪', '🍱', '🍜',
  '🥩', '🍖', '🥓', '🧆', '🫔', '🥐', '🫓', '🥙', '🌯', '🥟',
  '🍤', '🦐', '🦀', '🐟', '🦞', '🦑', '🐙', '🍥', '🍘', '🍙',
  // Sides & Snacks
  '🍟', '🧇', '🥞', '🧈', '🥨', '🥯', '🫕', '🍿', '🥜', '🌰',
  // Fruits & Vegetables
  '🥗', '🥑', '🍇', '🫐', '🍓', '🍎', '🍊', '🥭', '🍋', '🍌',
  '🌶️', '🧀', '🥚', '🌽', '🥕', '🧅', '🧄', '🥦', '🍅', '🥬',
  // Desserts & Sweets
  '🍰', '🧁', '🥧', '🍩', '🍦', '🍮', '🍫', '🍬', '🍭', '🎂',
  // Drinks
  '☕', '🍹', '🥤', '🍷', '🍺', '🧃', '🫖', '🧋', '🥂', '🍵',
  '🥛', '🍶', '🫗', '🍸', '🧉', '🥃',
  // Misc
  '🔥', '⭐', '💎', '👨‍🍳', '🏆', '❤️', '🌿', '🌾', '🎉', '✨',
];

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Icon</label>
      <div className="flex flex-wrap gap-1 p-2 border border-[#2A2A2A] bg-[#0D0D0D] max-h-[120px] overflow-auto">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            className={`w-8 h-8 flex items-center justify-center text-lg hover:bg-[#2A2A2A] transition-colors ${
              value === emoji ? 'bg-[#D62B2B]/30 ring-1 ring-[#D62B2B]' : ''
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      {value && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-[#999]">Selected: {value}</span>
          <button type="button" onClick={() => onChange('')} className="text-xs text-[#D62B2B] hover:underline">Clear</button>
        </div>
      )}
    </div>
  );
}

// ─── Tags Input ──────────────────────────────────────────────────────────────

const SUGGESTED_TAGS = ['Vegan', 'Vegetarian', 'Chicken', 'Beef', 'Seafood', 'Spicy', 'Nut-Free', 'Gluten-Free', 'Dairy-Free', 'Halal', 'New', 'Popular', 'Chef Special'];

function TagsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState('');
  const tags = value ? value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...tags, trimmed].join(', '));
    }
    setInput('');
  };

  const removeTag = (idx: number) => {
    onChange(tags.filter((_, i) => i !== idx).join(', '));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    }
  };

  const unusedSuggestions = SUGGESTED_TAGS.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()));

  return (
    <div>
      <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Tags</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, idx) => (
          <span key={idx} className="flex items-center gap-1 bg-[#2A2A2A] text-white text-xs font-body px-2 py-1">
            {tag}
            <button type="button" onClick={() => removeTag(idx)} className="text-[#999] hover:text-[#D62B2B]"><X size={10} /></button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type and press Enter..."
        className="w-full border border-[#2A2A2A] px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white"
      />
      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="text-[10px] font-body text-[#666] border border-[#2A2A2A] px-1.5 py-0.5 hover:border-[#555] hover:text-[#999] transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Category Form Dialog ─────────────────────────────────────────────────────

function CategoryDialog({
  initial,
  categories,
  onClose,
}: {
  initial?: MenuCategory;
  categories: MenuCategory[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [parentId, setParentId] = useState<string>(initial?.parentId ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');

  // Filter out self and own children to prevent circular references
  const parentOptions = categories.filter((c) => c.id !== initial?.id && !c.parentId);

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? api.patch(`/menu/categories/${initial.id}`, { name, parentId: parentId || null, icon: icon || null })
        : api.post('/menu/categories', { name, parentId: parentId || undefined, icon: icon || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[400px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide text-white">{initial ? 'EDIT' : 'ADD'} CATEGORY</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name"
          className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white placeholder:text-[#666]"
          autoFocus
        />
        <div>
          <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Parent Category</label>
          <select
            value={parentId} onChange={(e) => setParentId(e.target.value)}
            className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white"
          >
            <option value="" className="bg-[#0D0D0D] text-white">None (top-level)</option>
            {parentOptions.map((c) => <option key={c.id} value={c.id} className="bg-[#0D0D0D] text-white">{c.name}</option>)}
          </select>
        </div>
        <IconPicker value={icon} onChange={setIcon} />
        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button
            onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Item Form Dialog ─────────────────────────────────────────────────────────

function ItemDialog({
  categories,
  initial,
  onClose,
}: {
  categories: MenuCategory[];
  initial?: MenuItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    categoryId: initial?.categoryId ?? categories[0]?.id ?? '',
    type: initial?.type ?? 'FOOD' as const,
    price: initial ? String(Number(initial.price) / 100) : '',
    description: initial?.description ?? '',
    isAvailable: initial?.isAvailable ?? true,
    cookingStationId: initial?.cookingStationId ?? '',
    tags: initial?.tags ?? '',
    imageUrl: initial?.imageUrl ?? '',
    pieces: initial?.pieces ?? '',
    prepTime: initial?.prepTime ?? '',
    spiceLevel: initial?.spiceLevel ?? '',
    websiteVisible: initial?.websiteVisible ?? true,
    seoTitle: (initial as any)?.seoTitle ?? '',
    seoDescription: (initial as any)?.seoDescription ?? '',
  });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const { data: cookingStations = [] } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['cooking-stations'],
    queryFn: () => api.get('/cooking-stations'),
  });

  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const resized = await resizeImage(file, 'menuItem');
      const result = await api.upload<{ url: string }>('/upload/image', resized);
      set('imageUrl', result.url);
    } catch (err) {
      alert((err as Error).message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFileUpload(file);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const dto: CreateMenuItemDto & { isAvailable?: boolean } = {
        name: form.name,
        categoryId: form.categoryId,
        type: form.type as 'FOOD' | 'BEVERAGE' | 'MODIFIER',
        price: Math.round(parseFloat(form.price) * 100),
        description: form.description || undefined,
        cookingStationId: form.cookingStationId || null,
        tags: form.tags || undefined,
        imageUrl: form.imageUrl || undefined,
      };
      const extra = {
        pieces: form.pieces || null,
        prepTime: form.prepTime || null,
        spiceLevel: form.spiceLevel || null,
        websiteVisible: form.websiteVisible,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
      };
      if (initial) return api.patch(`/menu/${initial.id}`, { ...dto, ...extra, isAvailable: form.isAvailable });
      return api.post('/menu', { ...dto, ...extra });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
  });

  // Build flat list with indentation for sub-categories
  // Build flat list from top-level parents + their children only (no duplicates)
  const allCats = categories
    .filter((c) => !c.parentId)
    .flatMap((c) => {
      const result = [{ id: c.id, label: `${c.icon ? c.icon + ' ' : ''}${c.name}` }];
      if (c.children) {
        for (const child of c.children) {
          result.push({ id: child.id, label: `  └ ${child.icon ? child.icon + ' ' : ''}${child.name}` });
        }
      }
      return result;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[480px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">{initial ? 'EDIT' : 'ADD'} ITEM</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Category</label>
              <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white">
                {allCats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Kitchen Section</label>
              <select value={form.cookingStationId} onChange={(e) => set('cookingStationId', e.target.value)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white">
                <option value="">None (default kitchen)</option>
                {cookingStations.filter((s) => s.isActive).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {cookingStations.filter((s) => s.isActive).length === 0 && (
                <p className="text-[10px] text-[#666] mt-1">
                  No sections yet. Add them in <a href="/cooking-stations" className="text-[#D62B2B] hover:underline">Kitchen Sections</a>.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Price (Tk) *</label>
            <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => set('price', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>

          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Description</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>


          {/* Image Upload */}
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
              <Image size={12} className="inline mr-1" />Photo (Square)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
              }}
            />
            {form.imageUrl ? (
              <div className="flex items-start gap-3">
                <div className="w-24 h-24 border border-[#2A2A2A] overflow-hidden bg-[#0D0D0D] flex-shrink-0">
                  <img src={resolveImageUrl(form.imageUrl)} alt="Preview" className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-body text-[#999] hover:text-white border border-[#2A2A2A] px-3 py-1.5 transition-colors">
                    Change
                  </button>
                  <button type="button" onClick={() => set('imageUrl', '')}
                    className="text-xs font-body text-[#D62B2B] hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2 py-6 border border-dashed cursor-pointer transition-colors ${
                  dragOver ? 'border-[#D62B2B] bg-[#D62B2B]/5' : 'border-[#2A2A2A] hover:border-[#555] bg-[#0D0D0D]'
                }`}
              >
                {uploading ? (
                  <p className="text-xs font-body text-[#999]">Uploading...</p>
                ) : (
                  <>
                    <Upload size={20} className="text-[#555]" />
                    <p className="text-xs font-body text-[#999]">Click or drag image here</p>
                    <p className="text-[10px] font-body text-[#555]">JPEG, PNG, WebP — max 5 MB</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Tags */}
          <TagsInput value={form.tags} onChange={(v) => set('tags', v)} />

          {/* Website Detail Fields */}
          <div className="bg-[#0D0D0D] border border-[#2A2A2A] p-3 space-y-3">
            <p className="text-[#D62B2B] text-[10px] font-body font-medium tracking-widest uppercase">Website Display</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Pieces</label>
                <input value={form.pieces} onChange={(e) => set('pieces', e.target.value)} placeholder="e.g. 4-6"
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Prep Time</label>
                <input value={form.prepTime} onChange={(e) => set('prepTime', e.target.value)} placeholder="e.g. 15 min"
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[#666] text-[10px] font-body tracking-widest uppercase">Spice Level</label>
                <select value={form.spiceLevel} onChange={(e) => set('spiceLevel', e.target.value)}
                  className="bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-sm font-body focus:outline-none focus:border-[#D62B2B]">
                  <option value="">None</option>
                  <option value="Mild">Mild</option>
                  <option value="Medium">Medium</option>
                  <option value="Hot">Hot</option>
                  <option value="Very Hot">Very Hot</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-body text-[#999]">
              <input type="checkbox" checked={form.websiteVisible} onChange={(e) => set('websiteVisible', e.target.checked)} className="accent-[#D62B2B]" />
              Show on website
            </label>
            <div className="border-t border-[#2A2A2A] pt-2 mt-2 space-y-2">
              <p className="text-[#666] text-[10px] font-body tracking-widest uppercase">SEO (optional)</p>
              <input value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} placeholder="Custom title tag for this item"
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs font-body focus:outline-none focus:border-[#D62B2B]" />
              <input value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} placeholder="Custom meta description for this item"
                className="w-full bg-[#161616] border border-[#2A2A2A] text-white px-2 py-1.5 text-xs font-body focus:outline-none focus:border-[#D62B2B]" />
            </div>
          </div>

          {initial && (
            <label className="flex items-center gap-2 text-sm font-body text-[#999]">
              <input type="checkbox" checked={form.isAvailable} onChange={(e) => set('isAvailable', e.target.checked)} />
              Available
            </label>
          )}
        </div>

        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name.trim() || !form.price || mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Combo Items Dialog ───────────────────────────────────────────────────────

function ComboDialog({
  item,
  allItems,
  onClose,
}: {
  item: MenuItem;
  allItems: MenuItem[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<{ includedItemId: string; quantity: number }[]>(
    (item.comboItems ?? []).map((c) => ({ includedItemId: c.includedItemId, quantity: c.quantity })),
  );

  const availableItems = allItems.filter((m) => m.id !== item.id);

  const addRow = () => {
    const first = availableItems.find((m) => !rows.some((r) => r.includedItemId === m.id));
    if (first) setRows([...rows, { includedItemId: first.id, quantity: 1 }]);
  };

  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  const updateRow = (idx: number, field: string, value: unknown) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const mutation = useMutation({
    mutationFn: () => api.put(`/menu/${item.id}/combo-items`, { items: rows }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[520px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">COMBO ITEMS — {item.name}</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>

        <p className="text-xs font-body text-[#999]">Select menu items included in this combo bundle.</p>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <select
                value={row.includedItemId}
                onChange={(e) => updateRow(idx, 'includedItemId', e.target.value)}
                className="flex-1 border border-[#2A2A2A] px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616]"
              >
                {availableItems.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({formatCurrency(Number(m.price))})</option>
                ))}
              </select>
              <input
                type="number" min={1} value={row.quantity}
                onChange={(e) => updateRow(idx, 'quantity', parseInt(e.target.value) || 1)}
                className="w-16 border border-[#2A2A2A] px-2 py-2 text-sm font-body text-center outline-none focus:border-[#D62B2B]"
              />
              <button onClick={() => removeRow(idx)} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <button onClick={addRow} className="text-sm font-body text-[#D62B2B] hover:underline flex items-center gap-1">
          <Plus size={14} /> Add item
        </button>

        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button
            onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving...' : 'Save Combo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Linked Items Dialog ──────────────────────────────────────────────────────

function LinkedDialog({
  item,
  allItems,
  onClose,
}: {
  item: MenuItem;
  allItems: MenuItem[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<{ linkedMenuId: string; type: LinkedItemType; triggerQuantity: number; freeQuantity: number }[]>(
    (item.linkedItems ?? []).map((l) => ({
      linkedMenuId: l.linkedMenuId,
      type: l.type,
      triggerQuantity: l.triggerQuantity,
      freeQuantity: l.freeQuantity,
    })),
  );

  const availableItems = allItems.filter((m) => m.id !== item.id);

  const addRow = () => {
    const first = availableItems.find((m) => !rows.some((r) => r.linkedMenuId === m.id));
    if (first) setRows([...rows, { linkedMenuId: first.id, type: 'FREE', triggerQuantity: 1, freeQuantity: 1 }]);
  };

  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  const updateRow = (idx: number, field: string, value: unknown) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const mutation = useMutation({
    mutationFn: () => api.put(`/menu/${item.id}/linked-items`, { items: rows }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[620px] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">LINKED ITEMS — {item.name}</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>

        <p className="text-xs font-body text-[#999]">
          FREE = always included free. COMPLEMENTARY = free for every N ordered (e.g., buy 2 get 1 free drink).
        </p>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <select
                value={row.linkedMenuId}
                onChange={(e) => updateRow(idx, 'linkedMenuId', e.target.value)}
                className="flex-1 border border-[#2A2A2A] px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616]"
              >
                {availableItems.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <select
                value={row.type}
                onChange={(e) => updateRow(idx, 'type', e.target.value)}
                className="w-36 border border-[#2A2A2A] px-2 py-2 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616]"
              >
                <option value="FREE">Free</option>
                <option value="COMPLEMENTARY">Complementary</option>
              </select>
              {row.type === 'COMPLEMENTARY' && (
                <input
                  type="number" min={1} value={row.triggerQuantity} title="Trigger qty"
                  onChange={(e) => updateRow(idx, 'triggerQuantity', parseInt(e.target.value) || 1)}
                  className="w-14 border border-[#2A2A2A] px-2 py-2 text-sm font-body text-center outline-none focus:border-[#D62B2B]"
                />
              )}
              <input
                type="number" min={1} value={row.freeQuantity} title="Free qty"
                onChange={(e) => updateRow(idx, 'freeQuantity', parseInt(e.target.value) || 1)}
                className="w-14 border border-[#2A2A2A] px-2 py-2 text-sm font-body text-center outline-none focus:border-[#D62B2B]"
              />
              <button onClick={() => removeRow(idx)} className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <button onClick={addRow} className="text-sm font-body text-[#D62B2B] hover:underline flex items-center gap-1">
          <Plus size={14} /> Add linked item
        </button>

        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button
            onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving...' : 'Save Linked Items'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Menu Page ────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const qc = useQueryClient();
  const [catDialog, setCatDialog] = useState<{ open: boolean; cat?: MenuCategory }>({ open: false });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; item?: MenuItem }>({ open: false });
  const [comboDialog, setComboDialog] = useState<{ open: boolean; item?: MenuItem }>({ open: false });
  const [linkedDialog, setLinkedDialog] = useState<{ open: boolean; item?: MenuItem }>({ open: false });
  const [activeParent, setActiveParent] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSectionId, setBulkSectionId] = useState<string>('');
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<{ categoryName: string; name: string; price: number; description: string; tags: string; kitchenSection: string }[]>([]);
  const [csvResult, setCsvResult] = useState<{ created: number; updated?: number; skipped: number; errors: string[] } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const { data: categories = [] } = useQuery<MenuCategory[]>({
    queryKey: ['categories'],
    queryFn: () => api.get<MenuCategory[]>('/menu/categories'),
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu'],
    queryFn: () => api.get<MenuItem[]>('/menu'),
  });

  const { data: kitchenSections = [] } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['cooking-stations'],
    queryFn: () => api.get('/cooking-stations'),
  });
  const sectionById = new Map(kitchenSections.map((s) => [s.id, s] as const));

  const bulkAssignSection = useMutation({
    mutationFn: async (sectionId: string | null) => {
      const ids = Array.from(selectedIds);
      // Fan out PATCHes in parallel. /menu/:id already accepts
      // cookingStationId per item; a dedicated bulk endpoint would be
      // nicer but this is fine for realistic menu sizes (<500 items).
      await Promise.all(ids.map((id) => api.patch(`/menu/${id}`, { cookingStationId: sectionId })));
      return ids.length;
    },
    onSuccess: (count) => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      setBulkStatus(`Assigned ${count} item${count === 1 ? '' : 's'}`);
      setTimeout(() => setBulkStatus(null), 2500);
      setSelectedIds(new Set());
      setBulkSectionId('');
    },
    onError: (err: Error) => setBulkStatus(err.message || 'Failed to assign'),
  });

  const topCategories = categories.filter((c) => !c.parentId);
  const selectedParent = topCategories.find((c) => c.id === activeParent);
  const subCategories = selectedParent?.children ?? [];

  // Filter items based on category selection + search
  const filtered = (() => {
    let items = menuItems;
    if (activeSub) items = items.filter((m) => m.categoryId === activeSub);
    else if (activeParent) {
      const childIds = (selectedParent?.children ?? []).map((c) => c.id);
      items = items.filter((m) => m.categoryId === activeParent || childIds.includes(m.categoryId));
    }
    if (menuSearch.trim()) {
      const q = menuSearch.trim().toLowerCase();
      items = items.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        (m.tags ?? '').toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q)
      );
    }
    return items;
  })();

  const deleteCat = useMutation({
    mutationFn: (id: string) => api.delete(`/menu/categories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/menu/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['menu'] }),
  });

  const bulkMut = useMutation({
    mutationFn: (rows: typeof csvRows) => api.post<{ created: number; updated?: number; skipped: number; errors: string[] }>('/menu/bulk', { rows }),
    onSuccess: (data) => {
      setCsvResult(data);
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return;
      // Parse header
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const catIdx = headers.indexOf('category');
      const nameIdx = headers.indexOf('name');
      const priceIdx = headers.indexOf('price');
      const descIdx = headers.indexOf('description');
      const tagsIdx = headers.indexOf('tags');
      const sectionIdx = headers.findIndex((h) => h === 'kitchen_section' || h === 'section');

      if (nameIdx === -1 || priceIdx === -1 || catIdx === -1) {
        alert('CSV must have columns: category, name, price. Optional: kitchen_section, description, tags');
        return;
      }

      const rows = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim());
        return {
          categoryName: cols[catIdx] || '',
          name: cols[nameIdx] || '',
          price: Number(cols[priceIdx]) || 0,
          description: descIdx >= 0 ? cols[descIdx] || '' : '',
          tags: tagsIdx >= 0 ? cols[tagsIdx] || '' : '',
          kitchenSection: sectionIdx >= 0 ? cols[sectionIdx] || '' : '',
        };
      }).filter((r) => r.name && r.categoryName);

      setCsvRows(rows);
      setCsvResult(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const csv = 'category,name,price,kitchen_section,description,tags\nAppetizer,Spring Roll,150,Food,Crispy vegetable spring roll,Popular\nBeverage,Mango Lassi,120,Beverage,Fresh mango yogurt drink,New';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'menu_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Round-trip the current menu as a CSV matching the import template.
  // Fields with commas or quotes are escaped per RFC 4180 so Excel can
  // re-open them cleanly and the import side (which splits on comma) still
  // works on unescaped fields — which is why we prefer to *not* put commas
  // in menu item names in the first place.
  const downloadCurrentMenu = () => {
    const esc = (v: string | null | undefined) => {
      const s = (v ?? '').toString();
      if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const catById = new Map(categories.map((c) => [c.id, c.name] as const));
    const rows = menuItems
      .filter((m) => !m.deletedAt)
      .map((m) => {
        const catName = catById.get(m.categoryId) ?? '';
        const sectionName = (m as any).cookingStationId
          ? sectionById.get((m as any).cookingStationId)?.name ?? ''
          : '';
        const price = (Number(m.price) / 100).toFixed(2);
        return [
          esc(catName),
          esc(m.name),
          price,
          esc(sectionName),
          esc((m as any).description ?? ''),
          esc((m as any).tags ?? ''),
        ].join(',');
      });
    const csv = ['category,name,price,kitchen_section,description,tags', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `menu_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParentClick = (id: string | null) => {
    setActiveParent(id);
    setActiveSub(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Management</p>
          <h1 className="font-display text-4xl text-white tracking-wide">MENU</h1>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            placeholder="Search menu..."
            className="border border-[#2A2A2A] bg-[#0D0D0D] text-white px-3 py-2 text-sm font-body placeholder:text-[#555] focus:outline-none focus:border-[#D62B2B] w-48 transition-colors"
          />
          <button onClick={() => { setCsvOpen(true); setCsvRows([]); setCsvResult(null); }}
            className="flex items-center gap-1.5 border border-[#2A2A2A] px-4 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
            <Upload size={14} /> CSV Import
          </button>
          <button onClick={() => setCatDialog({ open: true })}
            className="flex items-center gap-1.5 border border-[#2A2A2A] px-4 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
            <Plus size={14} /> Category
          </button>
          <button onClick={() => setItemDialog({ open: true })}
            className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
            <Plus size={14} /> Item
          </button>
        </div>
      </div>

      {/* Line 1: Parent Categories */}
      <div className="border border-[#2A2A2A] bg-[#161616]">
        <div className="flex items-center gap-0 overflow-x-auto">
          <button
            onClick={() => handleParentClick(null)}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-body font-medium tracking-widest uppercase whitespace-nowrap transition-colors border-b-2 ${
              !activeParent ? 'border-[#D62B2B] text-[#D62B2B] bg-[#D62B2B]/5' : 'border-transparent text-[#999] hover:text-white'
            }`}
          >
            All ({menuItems.length})
          </button>
          {topCategories.map((cat) => {
            const childIds = (cat.children ?? []).map((c) => c.id);
            const count = menuItems.filter((m) => m.categoryId === cat.id || childIds.includes(m.categoryId)).length;
            const isActive = activeParent === cat.id;
            return (
              <div key={cat.id} className="flex items-center group">
                <button
                  onClick={() => handleParentClick(cat.id)}
                  className={`flex items-center gap-1.5 px-5 py-3 text-xs font-body font-medium tracking-widest uppercase whitespace-nowrap transition-colors border-b-2 ${
                    isActive ? 'border-[#D62B2B] text-[#D62B2B] bg-[#D62B2B]/5' : 'border-transparent text-[#999] hover:text-white'
                  }`}
                >
                  {cat.icon && <span className="text-base">{cat.icon}</span>}
                  {cat.name} ({count})
                </button>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-2">
                  <button onClick={() => setCatDialog({ open: true, cat })} className="text-[#555] hover:text-[#999] p-0.5"><Pencil size={10} /></button>
                  <button onClick={() => { if (confirm(`Delete category "${cat.name}"?`)) deleteCat.mutate(cat.id); }}
                    className="text-[#555] hover:text-[#D62B2B] p-0.5"><Trash2 size={10} /></button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Line 2: Subcategories (only when parent selected and has children) */}
        {activeParent && subCategories.length > 0 && (
          <div className="flex items-center gap-0 overflow-x-auto border-t border-[#2A2A2A] bg-[#0D0D0D]/50">
            <button
              onClick={() => setActiveSub(null)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-body font-medium tracking-widest uppercase whitespace-nowrap transition-colors border-b-2 ${
                !activeSub ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666] hover:text-white'
              }`}
            >
              All {selectedParent?.name}
            </button>
            {subCategories.map((sub) => {
              const subCount = menuItems.filter((m) => m.categoryId === sub.id).length;
              const isActive = activeSub === sub.id;
              return (
                <div key={sub.id} className="flex items-center group">
                  <button
                    onClick={() => setActiveSub(sub.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-body font-medium tracking-widest uppercase whitespace-nowrap transition-colors border-b-2 ${
                      isActive ? 'border-[#D62B2B] text-[#D62B2B]' : 'border-transparent text-[#666] hover:text-white'
                    }`}
                  >
                    {sub.icon && <span className="text-sm">{sub.icon}</span>}
                    {sub.name} ({subCount})
                  </button>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-1">
                    <button onClick={() => setCatDialog({ open: true, cat: sub })} className="text-[#555] hover:text-[#999] p-0.5"><Pencil size={9} /></button>
                    <button onClick={() => { if (confirm(`Delete sub-category "${sub.name}"?`)) deleteCat.mutate(sub.id); }}
                      className="text-[#555] hover:text-[#D62B2B] p-0.5"><Trash2 size={9} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-[#1A1A1A] border border-[#D62B2B] px-5 py-3 flex items-center gap-4 mb-2">
          <span className="text-white font-body text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-[10px] font-body tracking-widest uppercase text-[#999]">Kitchen Section</label>
            <select
              value={bulkSectionId}
              onChange={(e) => setBulkSectionId(e.target.value)}
              className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body focus:outline-none focus:border-[#D62B2B]"
            >
              <option value="">— Pick —</option>
              <option value="__NONE__">None (default kitchen)</option>
              {kitchenSections.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={() => bulkAssignSection.mutate(bulkSectionId === '__NONE__' ? null : bulkSectionId)}
              disabled={!bulkSectionId || bulkAssignSection.isPending}
              className="bg-[#D62B2B] hover:bg-[#F03535] text-white px-4 py-2 font-body font-medium text-sm transition-colors disabled:opacity-40"
            >
              {bulkAssignSection.isPending ? 'Assigning…' : 'Apply'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[#999] hover:text-white font-body text-xs tracking-widest uppercase px-3"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {bulkStatus && (
        <p className="text-[#4CAF50] font-body text-xs mb-2 px-1">{bulkStatus}</p>
      )}

      {/* Items table */}
      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-3 py-3 font-medium w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id))}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) filtered.forEach((m) => next.add(m.id));
                    else filtered.forEach((m) => next.delete(m.id));
                    setSelectedIds(next);
                  }}
                  className="accent-[#D62B2B]"
                />
              </th>
              <th className="px-5 py-3 font-medium w-12"></th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Section</th>
              <th className="px-5 py-3 font-medium">Price</th>
              <th className="px-5 py-3 font-medium">Tags</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const tags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
              const sectionId = (item as unknown as { cookingStationId?: string | null }).cookingStationId ?? null;
              const sectionName = sectionId ? sectionById.get(sectionId)?.name ?? '(deleted)' : '—';
              return (
                <tr key={item.id} className="border-b border-[#2A2A2A] last:border-0">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        setSelectedIds(next);
                      }}
                      className="accent-[#D62B2B]"
                    />
                  </td>
                  <td className="px-5 py-2">
                    {item.imageUrl ? (
                      <div className="w-10 h-10 border border-[#2A2A2A] overflow-hidden bg-[#0D0D0D]">
                        <img src={resolveImageUrl(item.imageUrl)} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 border border-[#2A2A2A] bg-[#0D0D0D] flex items-center justify-center text-[#333]">
                        <Image size={14} />
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 font-medium text-white">
                    {item.name}
                    {item.isCombo && <span className="ml-2 text-[10px] font-medium tracking-widest uppercase text-[#D62B2B] border border-[#D62B2B] px-1.5 py-0.5">COMBO</span>}
                    {(item.linkedItems?.length ?? 0) > 0 && <span className="ml-1 text-[10px] font-medium tracking-widest uppercase text-[#999] border border-[#2A2A2A] px-1.5 py-0.5">LINKED</span>}
                  </td>
                  <td className="px-5 py-3 text-[#999]">{item.category?.name ?? '--'}</td>
                  <td className={`px-5 py-3 ${sectionId ? 'text-white' : 'text-[#666]'}`}>{sectionName}</td>
                  <td className="px-5 py-3 text-white">{formatCurrency(Number(item.price))}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag, i) => (
                        <span key={i} className="text-[10px] font-body text-[#999] border border-[#2A2A2A] px-1.5 py-0.5">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium ${item.isAvailable ? 'text-green-600' : 'text-[#999]'}`}>
                      {item.isAvailable ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setComboDialog({ open: true, item })} title="Combo items" className="text-[#999] hover:text-[#D62B2B]"><Package size={14} /></button>
                      <button onClick={() => setLinkedDialog({ open: true, item })} title="Linked items" className="text-[#999] hover:text-[#D62B2B]"><Link2 size={14} /></button>
                      <button onClick={() => setItemDialog({ open: true, item })} className="text-[#999] hover:text-white"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteItem.mutate(item.id); }}
                        className="text-[#999] hover:text-[#D62B2B]"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-8 text-center text-[#999]">No menu items</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {catDialog.open && <CategoryDialog initial={catDialog.cat} categories={categories} onClose={() => setCatDialog({ open: false })} />}
      {itemDialog.open && <ItemDialog categories={categories} initial={itemDialog.item} onClose={() => setItemDialog({ open: false })} />}
      {comboDialog.open && comboDialog.item && <ComboDialog item={comboDialog.item} allItems={menuItems} onClose={() => setComboDialog({ open: false })} />}
      {linkedDialog.open && linkedDialog.item && <LinkedDialog item={linkedDialog.item} allItems={menuItems} onClose={() => setLinkedDialog({ open: false })} />}

      {/* CSV Import Modal */}
      {csvOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2A2A]">
              <div>
                <p className="text-xs font-body font-medium tracking-widest uppercase text-[#D62B2B]">Bulk Import</p>
                <h2 className="font-display text-xl text-white">CSV Menu Import</h2>
              </div>
              <button onClick={() => setCsvOpen(false)} className="text-[#666] hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-auto flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={downloadTemplate}
                  className="border border-[#2A2A2A] px-4 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
                  Download Template
                </button>
                <button onClick={downloadCurrentMenu}
                  className="border border-[#2A2A2A] px-4 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
                  Export Current Menu
                </button>
                <button onClick={() => csvFileRef.current?.click()}
                  className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
                  <Upload size={14} /> Choose CSV File
                </button>
                <input ref={csvFileRef} type="file" accept=".csv" onChange={handleCsvFile} className="hidden" />
              </div>

              <div className="text-[#666] text-xs font-body space-y-1">
                <p>CSV columns: <span className="text-white">category</span>, <span className="text-white">name</span>, <span className="text-white">price</span> (required) &mdash; <span className="text-[#999]">kitchen_section</span>, <span className="text-[#999]">description</span>, <span className="text-[#999]">tags</span> (optional)</p>
                <p>Price in Taka (e.g. 150 = ৳150). Re-uploading items with the same name updates them in place. New categories are auto-created.</p>
              </div>

              {csvRows.length > 0 && (
                <>
                  <div className="border border-[#2A2A2A] overflow-auto max-h-[40vh]">
                    <table className="w-full text-xs font-body">
                      <thead className="bg-[#0D0D0D] sticky top-0">
                        <tr className="text-[#999] uppercase tracking-widest">
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Kitchen Section</th>
                          <th className="px-3 py-2 text-right">Price</th>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-left">Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.map((r, i) => (
                          <tr key={i} className="border-t border-[#2A2A2A] text-white">
                            <td className="px-3 py-1.5 text-[#666]">{i + 1}</td>
                            <td className="px-3 py-1.5">{r.categoryName}</td>
                            <td className="px-3 py-1.5">{r.name}</td>
                            <td className="px-3 py-1.5 text-[#999]">{r.kitchenSection || '—'}</td>
                            <td className="px-3 py-1.5 text-right">{r.price}</td>
                            <td className="px-3 py-1.5 text-[#999] max-w-[150px] truncate">{r.description}</td>
                            <td className="px-3 py-1.5 text-[#999]">{r.tags}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-white font-body text-sm">{csvRows.length} item{csvRows.length !== 1 ? 's' : ''} ready to import</p>
                </>
              )}

              {csvResult && (
                <div className="border border-[#2A2A2A] bg-[#0D0D0D] p-4 space-y-2">
                  <p className="text-sm font-body">
                    <span className="text-[#4CAF50]">{csvResult.created} created</span>
                    {csvResult.updated && csvResult.updated > 0 && (
                      <span className="text-[#C8FF00] ml-3">{csvResult.updated} updated</span>
                    )}
                    {csvResult.skipped > 0 && <span className="text-[#FFA726] ml-3">{csvResult.skipped} skipped</span>}
                  </p>
                  {csvResult.errors.length > 0 && (
                    <div className="text-xs text-red-400 font-body space-y-0.5 max-h-24 overflow-auto">
                      {csvResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end px-5 py-4 border-t border-[#2A2A2A]">
              <button onClick={() => setCsvOpen(false)}
                className="border border-[#2A2A2A] px-5 py-2 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
                {csvResult ? 'Done' : 'Cancel'}
              </button>
              {csvRows.length > 0 && !csvResult && (
                <button
                  onClick={() => bulkMut.mutate(csvRows)}
                  disabled={bulkMut.isPending}
                  className="bg-[#D62B2B] text-white px-5 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors disabled:opacity-40"
                >
                  {bulkMut.isPending ? 'Importing...' : `Import ${csvRows.length} Items`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
