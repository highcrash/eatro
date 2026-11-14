import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { back } from './lib/router';

export function Header({ title, subtitle, onBack, right }: { title: ReactNode; subtitle?: ReactNode; onBack?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-beet text-white pt-[env(safe-area-inset-top)] shadow-sm">
      <div className="flex items-center gap-2 px-2 h-14">
        {onBack != null ? (
          <button onClick={() => back(onBack)} className="p-2 -ml-1 rounded-full active:bg-white/15" aria-label="Back">
            <ChevronLeft size={24} />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate leading-tight">{title}</div>
          {subtitle && <div className="text-xs text-white/80 truncate">{subtitle}</div>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white" style={{ background: color }}>
      {children}
    </span>
  );
}

export function Button({ children, onClick, kind = 'primary', disabled, className = '' }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; className?: string }) {
  const styles = {
    primary: 'bg-beet text-white active:bg-beet-dark',
    ghost: 'bg-white text-ink border border-ink-line active:bg-cream',
    danger: 'bg-white text-beet border border-beet active:bg-beet-soft',
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled} className={`px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-ink-soft text-sm py-16 px-6">{children}</div>;
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mx-3 my-2 rounded-lg bg-beet-soft text-beet-dark text-sm px-3 py-2">{error}</div>;
}
