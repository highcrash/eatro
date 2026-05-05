import { useSessionStore } from '../store/session.store';

/**
 * Customer-facing time formatters that always render in the BRANCH's
 * timezone (not the diner's device timezone).
 *
 * Why this matters: a customer travelling from Dhaka to Singapore who
 * scans a QR back home would otherwise see receipt + order times
 * shifted by 2 hours — confusing for "did my order get placed at 7pm
 * or 9pm?" troubleshooting calls. Devices with a wrong system clock
 * (kids' phones, factory-reset units) hit the same issue. Anchoring
 * everything in branch wall-clock removes the ambiguity.
 *
 * The branch tz is stored on the session via `branchTimezone`,
 * populated from `/public/table/:tableId` on the QR landing page.
 * Default `Asia/Dhaka` so the very first render before the table
 * fetch finishes never produces an invalid Intl call.
 */

function getBranchTz(): string {
  return useSessionStore.getState().branchTimezone || 'Asia/Dhaka';
}

export function formatBranchDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { timeZone: getBranchTz() });
}

export function formatBranchTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    timeZone: getBranchTz(),
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBranchDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    timeZone: getBranchTz(),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
