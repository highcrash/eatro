import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Persistent top-of-screen warning whenever the install isn't on a
 * fully-active license. Three states the banner surfaces:
 *
 *   missing → RED: "No license — read-only mode" + Activate link
 *   locked  → RED: "License {status}" (expired / revoked) + Re-activate
 *   grace   → AMBER: "License server unreachable — X day(s) left"
 *             (still fully functional, but the operator needs to
 *              know the clock is ticking)
 *
 * Hidden entirely when mode === 'active' — no chrome in the common
 * case. Refetches every 60s so the grace-days counter stays live
 * without the operator reloading.
 *
 * The server-side gate already 503s every POST/PATCH/DELETE when
 * the license is missing or locked; this banner is the UI-side
 * affordance that tells the operator WHY their writes are failing.
 */

type Mode = 'active' | 'grace' | 'locked' | 'missing';

interface Status {
  mode: Mode;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING' | null;
  daysRemaining: number;
  domain: string | null;
  reason: string;
}

export default function LicenseBanner() {
  const { data } = useQuery<Status>({
    queryKey: ['license', 'status'],
    queryFn: () => api.get<Status>('/license/status'),
    refetchInterval: 60_000,
    // Fail silently — the banner just doesn't render. The app's
    // core data queries will surface their own errors.
    retry: false,
  });

  if (!data || data.mode === 'active') return null;

  const config =
    data.mode === 'missing'
      ? {
          bg: 'bg-[#D62B2B]',
          Icon: KeyRound,
          title: 'NO LICENSE — READ-ONLY MODE',
          body: 'New orders, staff edits, and all other writes are blocked until you activate this install.',
          cta: 'Activate now',
        }
      : data.mode === 'locked'
        ? {
            bg: 'bg-[#D62B2B]',
            Icon: AlertTriangle,
            title: `LICENSE ${data.status ?? 'LOCKED'} — READ-ONLY MODE`,
            body: data.reason || 'Contact your administrator or the vendor to restore access.',
            cta: 'Re-activate',
          }
        : // grace
          {
            bg: 'bg-[#C97A12]',
            Icon: AlertTriangle,
            title: `GRACE PERIOD — ${data.daysRemaining} DAY${data.daysRemaining === 1 ? '' : 'S'} LEFT`,
            body: `License server hasn't been reached in a while. ${data.reason}. Writes still work; the install goes read-only when the grace window expires.`,
            cta: 'Re-verify',
          };

  const { Icon } = config;

  return (
    <div
      className={`${config.bg} text-white px-6 py-3 flex items-center gap-4 sticky top-0 z-30 border-b border-black/20`}
      role="alert"
    >
      <Icon className="w-5 h-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-display text-sm tracking-wider truncate">{config.title}</div>
        <div className="text-xs text-white/85 mt-0.5 truncate">{config.body}</div>
      </div>
      <Link
        to="/license"
        className="shrink-0 px-4 py-1.5 bg-white text-[#0D0D0D] text-xs font-display tracking-wider hover:bg-white/90 transition-colors"
      >
        {config.cta} →
      </Link>
    </div>
  );
}
