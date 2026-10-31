import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';

import { comboChoiceGroups, type ComboPick } from '../lib/combo';

interface Props {
  menuItem: MenuItem;
  initial?: ComboPick[];
  onClose: () => void;
  /** Counts per option (per one combo); caller writes them to the cart line. */
  onSave: (picks: ComboPick[]) => void;
}

/**
 * Split each of a combo's "guest picks" slots across its options, e.g.
 * Buddy Combo "Fizz — pick 4" → 2 Fizz, 1 Fizz White, 1 Fizz Orange.
 * Add is enabled only when every slot adds up exactly.
 */
export default function ComboChoiceDialog({ menuItem, initial, onClose, onSave }: Props) {
  const groups = comboChoiceGroups(menuItem);
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map((initial ?? []).map((p) => [p.includedItemId, p.quantity])));

  const totalFor = (optionIds: string[]) => optionIds.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
  const change = (id: string, delta: number, groupSize: number, optionIds: string[]) =>
    setCounts((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? 0;
      if (delta > 0 && totalFor(optionIds) >= groupSize) return prev;
      next.set(id, Math.max(0, cur + delta));
      return next;
    });
  const complete = groups.every((g) => totalFor(g.options.map((o) => o.id)) === g.size);

  const save = () =>
    onSave(
      groups.flatMap((g) =>
        g.options
          .filter((o) => (counts.get(o.id) ?? 0) > 0)
          .map((o) => ({ includedItemId: o.id, name: o.name, quantity: counts.get(o.id)! })),
      ),
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Combo choices</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{menuItem.name}</h3>
            <p className="text-[11px] text-theme-text-muted mt-0.5">{formatCurrency(Number((menuItem as { discountedPrice?: number | null }).discountedPrice ?? menuItem.price))}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-auto p-3 space-y-4">
          {groups.map((g) => {
            const ids = g.options.map((o) => o.id);
            const total = totalFor(ids);
            return (
              <div key={g.name} className="bg-theme-bg rounded-theme p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-theme-text">{g.name}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${total === g.size ? 'text-theme-text-muted' : 'text-theme-danger'}`}>
                    Pick {g.size} · {total}/{g.size}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {g.options.map((o) => {
                    const n = counts.get(o.id) ?? 0;
                    return (
                      <div
                        key={o.id}
                        className={`rounded-theme px-3 py-2 flex items-center justify-between gap-2 border ${
                          n > 0 ? 'bg-theme-accent/10 border-theme-accent' : 'bg-theme-surface border-theme-border'
                        }`}
                      >
                        <span className="text-sm text-theme-text">{o.name}</span>
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => change(o.id, -1, g.size, ids)}
                            disabled={n === 0}
                            className="w-8 h-8 rounded-theme bg-theme-bg text-theme-text flex items-center justify-center disabled:opacity-30"
                            aria-label={`One less ${o.name}`}
                          >
                            <Minus size={14} />
                          </button>
                          <span className="w-6 text-center text-sm font-bold text-theme-text">{n}</span>
                          <button
                            onClick={() => change(o.id, 1, g.size, ids)}
                            disabled={total >= g.size}
                            className="w-8 h-8 rounded-theme bg-theme-bg text-theme-text flex items-center justify-center disabled:opacity-30"
                            aria-label={`One more ${o.name}`}
                          >
                            <Plus size={14} />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-theme-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
          <button
            disabled={!complete}
            onClick={save}
            className="bg-theme-accent text-white font-bold px-4 py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-40"
          >
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
}
