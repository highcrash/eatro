import type { ReactNode } from 'react';

/**
 * Minimal UI primitives shared across pages. Nothing clever — typed
 * Tailwind class presets, so the pages themselves stay readable and
 * the visual language is consistent without a separate design system.
 */

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled,
  onClick,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const base = 'font-body font-medium tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2';
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2' };
  const variants = {
    primary: 'bg-black text-white hover:bg-black-mid',
    ghost: 'text-black-text hover:bg-white-soft',
    danger: 'bg-red text-white hover:bg-red-bright',
    outline: 'border border-white-border text-black-text hover:bg-white-soft',
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-white-border px-3 py-2 text-sm font-body outline-none focus:border-black ${props.className ?? ''}`}
    />
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <label className={`block text-[11px] uppercase tracking-widest font-body font-medium text-black-text/70 mb-1.5 ${className}`}>
      {children}
    </label>
  );
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div onClick={onClick} className={`bg-white border border-white-border ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warn' | 'danger' }) {
  const tones = {
    neutral: 'bg-white-soft text-black-text',
    success: 'bg-green-light text-green',
    warn: 'bg-amber-light text-amber',
    danger: 'bg-red/10 text-red',
  };
  return (
    <span className={`inline-block text-[10px] uppercase tracking-widest font-body font-medium px-2 py-0.5 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-16">
      <p className="font-display text-3xl text-black-text/40">{title}</p>
      {hint && <p className="text-sm text-black-text/60 mt-2">{hint}</p>}
    </div>
  );
}
