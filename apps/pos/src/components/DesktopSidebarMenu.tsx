import { useEffect, useRef, useState } from 'react';
import { LogOut, KeyRound, Printer, Activity, Unlink, RefreshCw, User, Stethoscope } from 'lucide-react';

/**
 * Shape of the desktop bridge that the Electron wrapper publishes on
 * window.__desktop. The bridge is absent when the POS is running in a
 * regular browser tab — in that case this component renders nothing and
 * the caller falls back to the plain Logout button.
 */
export interface DesktopBridge {
  appVersion: string;
  cashierRole: string;
  cashierName: string;
  terminalBranch: string;
  signOut: () => void;
  openChangePin: () => void;
  openPrinterSettings: () => void;
  openSyncPanel: () => void;
  openDiagnostics?: () => void;
  requestUnpair: () => void;
}

declare global {
  interface Window { __desktop?: DesktopBridge }
}

/**
 * Returns the current desktop bridge if one is live, or null. Components that
 * use this should also subscribe to window changes if they need to react to
 * bridge mount/unmount — the POS sidebar remounts whenever PosLayout does,
 * which is frequent enough in practice.
 */
export function useDesktopBridge(): DesktopBridge | null {
  const [bridge, setBridge] = useState<DesktopBridge | null>(window.__desktop ?? null);
  useEffect(() => {
    // Poll for the bridge during the first second of mount to cover the
    // (small) window where the sidebar renders before PosEmbed's effect has
    // published window.__desktop.
    const i = setInterval(() => {
      setBridge(window.__desktop ?? null);
    }, 200);
    const stop = setTimeout(() => clearInterval(i), 2000);
    return () => { clearInterval(i); clearTimeout(stop); };
  }, []);
  return bridge;
}

/**
 * Sidebar pop-up menu shown when running inside the desktop shell.
 * Replaces the plain user avatar + Logout buttons with an expandable menu
 * that hosts all desktop-only actions (Change PIN, Printer Settings, Sync,
 * Unpair, Sign Out).
 */
export function DesktopSidebarMenu({ bridge, userName }: { bridge: DesktopBridge; userName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isOwner = bridge.cashierRole === 'OWNER';
  const initial = userName.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Menu · ${userName}`}
        className="w-full flex flex-col items-center gap-1 py-2 rounded-theme text-theme-sidebar-text hover:bg-theme-bg transition-colors"
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${open ? 'bg-theme-accent text-white' : 'bg-theme-bg text-theme-text-muted'}`}>
          <span className="text-sm font-bold">{initial}</span>
        </div>
        <span className="text-[10px] font-semibold">Menu</span>
      </button>

      {open && (
        <div
          className="absolute left-[88px] bottom-0 w-[260px] bg-theme-surface border border-theme-border rounded-theme shadow-lg z-50"
          role="menu"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-theme-border">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-theme-text-muted">
              <User size={12} />
              <span>Signed in as</span>
            </div>
            <p className="text-sm font-semibold text-theme-text mt-0.5">{bridge.cashierName}</p>
            <span className="inline-block mt-1 text-[9px] font-bold tracking-widest uppercase bg-theme-bg text-theme-accent px-2 py-0.5 rounded-theme">
              {bridge.cashierRole}
            </span>
            <p className="text-[10px] text-theme-text-muted mt-2">{bridge.terminalBranch}</p>
          </div>

          {/* Cashier actions (everyone) */}
          <MenuItem icon={KeyRound} label="Change PIN" onClick={() => { setOpen(false); bridge.openChangePin(); }} />

          {isOwner ? (
            <>
              <SectionLabel>Owner controls</SectionLabel>
              <MenuItem icon={Activity} label="Sync status" onClick={() => { setOpen(false); bridge.openSyncPanel(); }} />
              <MenuItem icon={Printer} label="Printer settings" onClick={() => { setOpen(false); bridge.openPrinterSettings(); }} />
              {bridge.openDiagnostics && (
                <MenuItem icon={Stethoscope} label="Diagnostics" onClick={() => { setOpen(false); bridge.openDiagnostics!(); }} />
              )}
              <MenuItem icon={RefreshCw} label="Check for updates" onClick={() => {
                setOpen(false);
                const w = window as unknown as { desktop?: { update?: { check: () => Promise<unknown> } } };
                void w.desktop?.update?.check();
              }} />
              <MenuItem icon={Unlink} label="Unpair terminal…" danger onClick={() => { setOpen(false); bridge.requestUnpair(); }} />
            </>
          ) : (
            <p className="px-4 py-2 text-[11px] text-theme-text-muted leading-snug">
              Printer and sync settings are owner-only.
            </p>
          )}

          <div className="border-t border-theme-border" />
          <MenuItem icon={LogOut} label="Sign out" danger onClick={() => { setOpen(false); bridge.signOut(); }} />

          <div className="px-4 py-2 text-[10px] text-theme-text-muted text-right tracking-wider">
            v{bridge.appVersion}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon, label, onClick, danger,
}: {
  icon: typeof LogOut;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-theme-bg ${
        danger ? 'text-theme-danger' : 'text-theme-text'
      }`}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-3 pb-1 text-[9px] font-bold tracking-widest uppercase text-theme-text-muted">
      {children}
    </p>
  );
}
