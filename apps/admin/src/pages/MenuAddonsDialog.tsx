import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus } from 'lucide-react';

import type { MenuItem, MenuItemAddonGroup, UpsertAddonGroupDto } from '@restora/types';
import { formatCurrency } from '@restora/utils';
import { api } from '../lib/api';

interface Props {
  menuItem: MenuItem;
  /** All branch menu items so we can populate the addon-options picker
   *  with rows where isAddon=true. */
  allItems: MenuItem[];
  onClose: () => void;
}

export default function MenuAddonsDialog({ menuItem, allItems, onClose }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MenuItemAddonGroup | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: groups = [], isLoading } = useQuery<MenuItemAddonGroup[]>({
    queryKey: ['addon-groups', menuItem.id],
    queryFn: () => api.get<MenuItemAddonGroup[]>(`/menu/${menuItem.id}/addon-groups`),
  });

  const addonItems = allItems.filter((m) => m.isAddon && !m.deletedAt).sort((a, b) => a.name.localeCompare(b.name));

  const removeMut = useMutation({
    mutationFn: (groupId: string) => api.delete(`/menu/addon-groups/${groupId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addon-groups', menuItem.id] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Delete failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#161616] w-[600px] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <div>
            <p className="text-[#CE93D8] text-[10px] font-body font-medium tracking-widest uppercase">Addons</p>
            <h3 className="font-display text-2xl text-white tracking-wide">{menuItem.name}</h3>
            <p className="text-xs text-[#666] mt-0.5">Customers can pick from these groups when ordering this item.</p>
          </div>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {addonItems.length === 0 && (
            <div className="bg-[#3a2a00] border border-[#FFA726] px-3 py-2 text-xs text-[#FFA726]">
              You haven't created any addon items yet. Add a menu item with the <strong>"Treat as addon"</strong> toggle on, then come back here to attach it to a group.
            </div>
          )}

          {isLoading ? (
            <p className="text-[#666] text-sm">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="text-[#666] text-sm">No addon groups yet.</p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="bg-[#0D0D0D] border border-[#2A2A2A] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-body font-medium text-white">{g.name}</p>
                      <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">
                        {g.minPicks === 0 ? `Optional · max ${g.maxPicks}` : g.minPicks === g.maxPicks ? `Pick exactly ${g.minPicks}` : `Pick ${g.minPicks}–${g.maxPicks}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(g)} className="text-[#999] hover:text-white text-xs font-body uppercase tracking-widest">Edit</button>
                      <button onClick={() => { if (confirm(`Delete group "${g.name}"?`)) removeMut.mutate(g.id); }} className="text-[#D62B2B] hover:text-[#F03535] text-xs font-body uppercase tracking-widest">Delete</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.options.map((opt) => (
                      <span key={opt.id} className="text-[10px] font-body text-white bg-[#2A2A2A] px-2 py-0.5">
                        {opt.addon?.name ?? '(missing)'}
                        {opt.addon && Number(opt.addon.price) > 0 && <span className="text-[#999] ml-1">+{formatCurrency(Number(opt.addon.price))}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-[#D62B2B]">{error}</p>}

          <button
            onClick={() => setShowCreate(true)}
            disabled={addonItems.length === 0}
            className="w-full bg-[#0D0D0D] border border-dashed border-[#2A2A2A] hover:border-[#CE93D8] text-[#CE93D8] py-2.5 text-sm font-body inline-flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Plus size={14} /> Add Group
          </button>
        </div>
      </div>

      {(showCreate || editing) && (
        <GroupForm
          menuItemId={menuItem.id}
          initial={editing ?? null}
          addonItems={addonItems}
          onClose={() => { setShowCreate(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ─── Single group create / edit form ────────────────────────────────────────

function GroupForm({ menuItemId, initial, addonItems, onClose }: {
  menuItemId: string;
  initial: MenuItemAddonGroup | null;
  addonItems: MenuItem[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    minPicks: String(initial?.minPicks ?? 0),
    maxPicks: String(initial?.maxPicks ?? 1),
  });
  const [picks, setPicks] = useState<Set<string>>(new Set((initial?.options ?? []).map((o) => o.addonItemId)));
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const orderedPicks = (initial?.options ?? [])
    .filter((o) => picks.has(o.addonItemId))
    .map((o) => o.addonItemId)
    .concat(
      [...picks].filter((id) => !(initial?.options ?? []).some((o) => o.addonItemId === id)),
    );

  const dto: UpsertAddonGroupDto = {
    name: form.name.trim(),
    minPicks: Number(form.minPicks) || 0,
    maxPicks: Number(form.maxPicks) || 1,
    addonItemIds: orderedPicks,
  };

  const submit = useMutation({
    mutationFn: () => initial
      ? api.patch<MenuItemAddonGroup & { warnings?: string[] }>(`/menu/addon-groups/${initial.id}`, dto)
      : api.post<MenuItemAddonGroup & { warnings?: string[] }>(`/menu/${menuItemId}/addon-groups`, dto),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['addon-groups', menuItemId] });
      void qc.invalidateQueries({ queryKey: ['menu'] });
      const ws = (res as { warnings?: string[] }).warnings ?? [];
      if (ws.length > 0) {
        setWarnings(ws);
        // Don't auto-close — admin should see + ack the no-recipe warning.
        return;
      }
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  const togglePick = (id: string) => {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-[#161616] w-full max-w-md max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <h4 className="font-display text-lg text-white tracking-wide">{initial ? 'EDIT GROUP' : 'NEW GROUP'}</h4>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={14} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Sides, Sauces, Extras…"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm font-body text-white outline-none focus:border-[#CE93D8]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Min Picks</label>
              <input type="number" min="0" value={form.minPicks} onChange={(e) => setForm({ ...form, minPicks: e.target.value })}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm font-body text-white outline-none focus:border-[#CE93D8]" />
              <p className="text-[10px] text-[#555] mt-1">0 = optional group</p>
            </div>
            <div>
              <label className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Max Picks</label>
              <input type="number" min="1" value={form.maxPicks} onChange={(e) => setForm({ ...form, maxPicks: e.target.value })}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 text-sm font-body text-white outline-none focus:border-[#CE93D8]" />
            </div>
          </div>
          <div>
            <p className="text-xs font-body text-[#999] tracking-widest uppercase block mb-1">Options</p>
            <div className="space-y-1 max-h-60 overflow-auto bg-[#0D0D0D] border border-[#2A2A2A] p-2">
              {addonItems.map((it) => {
                const checked = picks.has(it.id);
                const noRecipe = !(it as { recipe?: { id: string } | null }).recipe;
                return (
                  <label key={it.id} className="flex items-center gap-2 text-sm font-body text-[#999] cursor-pointer hover:text-white">
                    <input type="checkbox" checked={checked} onChange={() => togglePick(it.id)} className="accent-[#CE93D8]" />
                    <span className="flex-1">{it.name}</span>
                    <span className="text-xs text-[#666]">{Number(it.price) > 0 ? `+${formatCurrency(Number(it.price))}` : 'Free'}</span>
                    {noRecipe && <span className="text-[9px] text-[#FFA726] uppercase tracking-wider">no recipe</span>}
                  </label>
                );
              })}
              {addonItems.length === 0 && <p className="text-xs text-[#666]">No addon items available.</p>}
            </div>
            <p className="text-[10px] text-[#555] mt-1">Items marked "no recipe" won't deduct any stock when picked.</p>
          </div>

          {warnings.length > 0 && (
            <div className="bg-[#3a2a00] border border-[#FFA726] px-3 py-2 text-xs text-[#FFA726]">
              {warnings.join(' ')}
              <div className="mt-2"><button onClick={onClose} className="text-[#FFA726] underline">Got it — close</button></div>
            </div>
          )}

          {error && <p className="text-xs text-[#D62B2B]">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2 text-sm font-body text-[#999]">Cancel</button>
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !form.name.trim() || picks.size === 0}
              className="flex-1 bg-[#CE93D8] text-black py-2 text-sm font-body font-medium disabled:opacity-40"
            >
              {submit.isPending ? 'Saving…' : 'Save Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
