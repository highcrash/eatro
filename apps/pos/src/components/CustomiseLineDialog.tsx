import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { api } from '../lib/api';

interface RecipeLine {
  ingredientId: string;
  ingredient: { id: string; name: string };
}

interface RecipeResponse {
  items: RecipeLine[];
}

interface Props {
  menuItemId: string;
  menuItemName: string;
  initialRemovedIds: string[];
  onClose: () => void;
  onSave: (removedIngredientIds: string[], removedNames: string[]) => void;
}

/**
 * Per-line ingredient-removal picker. Loads the menu item's recipe,
 * shows each ingredient with a checkbox, and returns the selected IDs
 * to the caller. The caller re-keys the cart line so 2× without garlic
 * lives separately from 2× normal in the cart and on the KT.
 */
export default function CustomiseLineDialog({ menuItemId, menuItemName, initialRemovedIds, onClose, onSave }: Props) {
  const [removed, setRemoved] = useState<Set<string>>(new Set(initialRemovedIds));

  const { data: recipe, isLoading } = useQuery<RecipeResponse | null>({
    queryKey: ['recipe-by-menu-item', menuItemId],
    queryFn: async () => {
      try {
        return await api.get<RecipeResponse>(`/cashier-ops/recipes/menu-item/${menuItemId}`);
      } catch {
        return null;
      }
    },
  });

  const lines = recipe?.items ?? [];

  const toggle = (id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () => {
    const ids = Array.from(removed);
    const idToName = new Map(lines.map((l) => [l.ingredient.id, l.ingredient.name] as const));
    const names = ids.map((id) => idToName.get(id) ?? '');
    onSave(ids, names.filter((n) => n));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Customise</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{menuItemName}</h3>
            <p className="text-[11px] text-theme-text-muted mt-0.5">
              Tick ingredients the customer wants <span className="text-theme-danger font-bold">removed</span>. The kitchen ticket prints "NO &lt;ingredient&gt;" and stock isn't deducted for those.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-auto p-3 space-y-1">
          {isLoading ? (
            <p className="text-xs text-theme-text-muted text-center py-12">Loading recipe…</p>
          ) : lines.length === 0 ? (
            <p className="text-xs text-theme-text-muted text-center py-12">This menu item has no recipe — nothing to remove.</p>
          ) : lines.map((line) => {
            const checked = removed.has(line.ingredient.id);
            return (
              <button
                key={line.ingredient.id}
                onClick={() => toggle(line.ingredient.id)}
                className={`w-full text-left rounded-theme px-3 py-2.5 flex items-center gap-3 transition-colors ${
                  checked ? 'bg-theme-danger/10 border border-theme-danger' : 'bg-theme-bg hover:bg-theme-surface-alt border border-theme-border'
                }`}
              >
                <input type="checkbox" checked={checked} readOnly className="accent-theme-danger" />
                <span className={`flex-1 text-sm ${checked ? 'text-theme-danger font-bold line-through' : 'text-theme-text'}`}>{line.ingredient.name}</span>
                {checked && <span className="text-[10px] font-bold uppercase tracking-wider text-theme-danger">No</span>}
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-theme-border flex gap-2">
          <button onClick={onClose} className="flex-1 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold px-4 py-2.5 rounded-theme text-sm">Cancel</button>
          <button onClick={save} disabled={lines.length === 0} className="flex-1 bg-theme-accent text-white font-bold px-4 py-2.5 rounded-theme text-sm hover:opacity-90 disabled:opacity-50">
            Save ({removed.size} removed)
          </button>
        </div>
      </div>
    </div>
  );
}
