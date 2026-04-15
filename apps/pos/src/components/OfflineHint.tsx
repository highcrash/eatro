import { WifiOff } from 'lucide-react';

/**
 * Consistent "this action needs internet" marker used next to disabled
 * buttons, and as a page-level banner on server-dependent screens
 * (purchasing, finance, pre-ready). Matches the red desktop sync banner
 * at the top of the screen but at a local scope.
 */

export function OfflineInlineHint({ label = 'Needs internet' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-theme-danger"
      title="This action is disabled while offline"
    >
      <WifiOff size={11} />
      {label}
    </span>
  );
}

export function OfflineBanner({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 bg-theme-danger/10 border-l-4 border-theme-danger px-4 py-3 mb-4">
      <WifiOff size={18} className="text-theme-danger" />
      <p className="text-sm text-theme-danger font-semibold">
        {message ?? 'Offline mode — the actions on this page need internet and are temporarily disabled.'}
      </p>
    </div>
  );
}
