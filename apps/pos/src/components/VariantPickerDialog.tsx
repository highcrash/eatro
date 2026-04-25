import { X } from 'lucide-react';

import type { MenuItem } from '@restora/types';
import { formatCurrency } from '@restora/utils';

interface Props {
  parent: MenuItem;
  variants: MenuItem[];
  onPick: (variant: MenuItem) => void;
  onClose: () => void;
}

/**
 * Cashier picks one variant of a parent menu item (e.g. "Hargao" →
 * "Prawn ৳450" or "Chicken ৳350"). Each variant is a real MenuItem
 * with its own price + recipe; on pick we just hand the chosen child
 * back to the caller so it can be added to the cart like any other
 * menu item — no special order flow needed.
 */
export default function VariantPickerDialog({ parent, variants, onPick, onClose }: Props) {
  const available = variants.filter((v) => v.isAvailable !== false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-theme-accent">Pick a variant</p>
            <h3 className="text-lg font-bold text-theme-text mt-0.5">{parent.name}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-auto p-3 grid grid-cols-1 gap-2">
          {available.length === 0 ? (
            <p className="text-xs text-theme-text-muted text-center py-12">No variants are currently available.</p>
          ) : available.map((v) => (
            <button
              key={v.id}
              onClick={() => onPick(v)}
              className="text-left bg-theme-bg hover:bg-theme-surface-alt rounded-theme px-4 py-3 flex items-center justify-between transition-colors border border-theme-border hover:border-theme-accent"
            >
              <div>
                <p className="text-sm font-bold text-theme-text">{v.name}</p>
                {v.description && <p className="text-[11px] text-theme-text-muted mt-0.5">{v.description}</p>}
              </div>
              <span className="text-base font-bold text-theme-accent shrink-0 ml-3">{formatCurrency(Number(v.price))}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
