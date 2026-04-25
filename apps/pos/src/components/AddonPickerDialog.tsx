import { useState, useMemo } from 'react';
import { X } from 'lucide-react';

import type { MenuItem, MenuItemAddonGroup } from '@restora/types';
import { formatCurrency } from '@restora/utils';

interface SelectedPick {
  groupId: string;
  groupName: string;
  addonItemId: string;
  addonName: string;
  price: number;
}

interface Props {
  /** Parent menu item that owns the groups. */
  menuItem: MenuItem;
  /** Addon groups attached to it. */
  groups: MenuItemAddonGroup[];
  /** Initial selections when re-customising an existing cart line. */
  initial?: SelectedPick[];
  onClose: () => void;
  /** Returns the picks (may be empty); caller writes them to the cart. */
  onSave: (picks: SelectedPick[]) => void;
}

/**
 * Per-line addon chooser. Renders one section per group, enforces
 * minPicks / maxPicks, and disables Save until every required group is
 * satisfied. Total = base price + sum of ticked addons; cashier sees
 * it live so they can quote the customer.
 */
export default function AddonPickerDialog({ menuItem, groups, initial, onClose, onSave }: Props) {
  const [picks, setPicks] = useState<Map<string, SelectedPick>>(() => {
    const m = new Map<string, SelectedPick>();
    for (const p of initial ?? []) m.set(`${p.groupId}:${p.addonItemId}`, p);
    return m;
  });

  const togglePick = (group: MenuItemAddonGroup, opt: { id: string; name: string; price: number }) => {
    const key = `${group.id}:${opt.id}`;
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      // Enforce maxPicks per group: if at limit, remove the oldest pick
      // in this group (FIFO) to make room. Cashier intent: tap = pick.
      const inGroup = [...next.values()].filter((p) => p.groupId === group.id);
      if (inGroup.length >= group.maxPicks) {
        // Drop the first one we recorded.
        const drop = `${group.id}:${inGroup[0].addonItemId}`;
        next.delete(drop);
      }
      next.set(key, {
        groupId: group.id,
        groupName: group.name,
        addonItemId: opt.id,
        addonName: opt.name,
        price: opt.price,
      });
      return next;
    });
  };

  const picksByGroup = useMemo(() => {
    const m = new Map<string, SelectedPick[]>();
    for (const p of picks.values()) {
      const arr = m.get(p.groupId) ?? [];
      arr.push(p);
      m.set(p.groupId, arr);
    }
    return m;
  }, [picks]);

  const unmet = groups.filter((g) => (picksByGroup.get(g.id)?.length ?? 0) < g.minPicks);
  const canSave = unmet.length === 0;
  const addonsTotal = [...picks.values()].reduce((s, p) => s + p.price, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Add-ons</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{menuItem.name}</h3>
            <p className="text-[11px] text-theme-text-muted mt-0.5">Base {formatCurrency(Number(menuItem.price))}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-auto p-3 space-y-4">
          {groups.length === 0 && (
            <p className="text-xs text-theme-text-muted text-center py-12">No addon groups configured for this item.</p>
          )}
          {groups.map((g) => {
            const picksHere = picksByGroup.get(g.id) ?? [];
            const need = g.minPicks > 0 && picksHere.length < g.minPicks;
            const limit = `${g.minPicks === 0 ? 'Up to' : `Pick ${g.minPicks === g.maxPicks ? 'exactly' : 'between'} ${g.minPicks}${g.minPicks === g.maxPicks ? '' : `–${g.maxPicks}`}`} ${g.maxPicks > 1 ? '' : ''}`.trim();
            return (
              <div key={g.id} className="bg-theme-bg rounded-theme p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-theme-text">{g.name}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${need ? 'text-theme-danger' : 'text-theme-text-muted'}`}>
                    {g.minPicks === 0 ? `Optional · max ${g.maxPicks}` : `Required · ${picksHere.length}/${g.minPicks === g.maxPicks ? g.minPicks : `${g.minPicks}-${g.maxPicks}`}`}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {g.options.length === 0 ? (
                    <p className="text-[11px] text-theme-text-muted">No options.</p>
                  ) : g.options.map((opt) => {
                    const addon = opt.addon;
                    if (!addon) return null;
                    const checked = picks.has(`${g.id}:${addon.id}`);
                    const disabled = addon.isAvailable === false;
                    return (
                      <button
                        key={opt.id}
                        disabled={disabled}
                        onClick={() => togglePick(g, { id: addon.id, name: addon.name, price: Number(addon.price) })}
                        className={`w-full text-left rounded-theme px-3 py-2 flex items-center justify-between gap-2 transition-colors border ${
                          checked
                            ? 'bg-theme-accent/10 border-theme-accent text-theme-text'
                            : disabled
                              ? 'bg-theme-bg border-theme-border text-theme-text-muted opacity-50'
                              : 'bg-theme-surface border-theme-border hover:border-theme-accent text-theme-text'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={checked} readOnly className="accent-theme-accent" />
                          <span className="text-sm">{addon.name}</span>
                          {disabled && <span className="text-[9px] uppercase tracking-wider text-theme-danger">unavailable</span>}
                        </span>
                        <span className="text-sm font-bold shrink-0">{Number(addon.price) > 0 ? `+${formatCurrency(Number(addon.price))}` : 'Free'}</span>
                      </button>
                    );
                  })}
                </div>
                {limit && <p className="text-[10px] text-theme-text-muted mt-2">{limit}</p>}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-theme-border flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">Add-on total</p>
            <p className="text-base font-bold text-theme-text">+{formatCurrency(addonsTotal)}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
            <button
              disabled={!canSave}
              onClick={() => onSave([...picks.values()])}
              className="bg-theme-accent text-white font-bold px-4 py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-40"
              title={canSave ? '' : `Required: ${unmet.map((g) => g.name).join(', ')}`}
            >
              Add to Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
