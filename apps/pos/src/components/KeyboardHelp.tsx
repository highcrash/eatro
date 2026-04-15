import { X } from 'lucide-react';

/**
 * Keyboard cheat-sheet — press `?` or F1 anywhere in the POS to pop this up.
 * Fixed bindings for now; a user-customisable shortcut editor can slot in
 * once we add a settings store for keybindings.
 */

interface Binding { keys: string; label: string }
interface Group { title: string; bindings: Binding[] }

export const SHORTCUT_GROUPS: Group[] = [
  {
    title: 'Navigation',
    bindings: [
      { keys: 'Alt + T', label: 'Tables / Home' },
      { keys: 'Alt + N', label: 'New order (Cashier)' },
      { keys: 'Alt + C', label: 'Customers' },
      { keys: 'Alt + K', label: 'Kitchen' },
      { keys: 'Alt + R', label: 'Reports (Sales)' },
      { keys: 'Alt + B', label: 'Bookings' },
      { keys: 'Alt + P', label: 'Purchasing' },
      { keys: 'Alt + F', label: 'Finance' },
      { keys: 'Alt + Y', label: 'Pre-ready' },
    ],
  },
  {
    title: 'In the Add Items screen',
    bindings: [
      { keys: 'a–z / 0–9',  label: 'Type to search the menu' },
      { keys: 'Arrows',     label: 'Move the highlight' },
      { keys: 'Enter',      label: 'Add the highlighted item to cart' },
      { keys: 'Esc',        label: 'Close / clear search' },
    ],
  },
  {
    title: 'Global',
    bindings: [
      { keys: '? / F1',  label: 'Open this help' },
      { keys: 'Esc',     label: 'Dismiss dialog / clear search' },
    ],
  },
];

export function KeyboardHelp({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}>
      <div
        className="bg-theme-surface rounded-theme border border-theme-border w-full max-w-xl max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-theme-accent">Keyboard</p>
            <h2 className="text-xl font-extrabold text-theme-text">SHORTCUTS</h2>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">
                {group.title}
              </p>
              <div className="divide-y divide-theme-border border border-theme-border rounded-theme">
                {group.bindings.map((b) => (
                  <div key={b.keys} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-theme-text">{b.label}</span>
                    <kbd className="px-2 py-0.5 rounded-theme bg-theme-bg border border-theme-border text-[11px] font-mono text-theme-text">
                      {b.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="text-[11px] text-theme-text-muted">
            User-customisable bindings are on the roadmap. For now, defaults
            above apply to everyone using this terminal.
          </p>
        </div>
      </div>
    </div>
  );
}
