/**
 * Format a date for display in POS receipts / reports.
 */
export function formatDate(date: Date | string, locale = 'en-BD'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string, locale = 'en-BD'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));
}

export function formatTime(date: Date | string, locale = 'en-BD'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(date));
}

/** Returns elapsed seconds from a given date to now */
export function elapsedSeconds(from: Date | string): number {
  return Math.floor((Date.now() - new Date(from).getTime()) / 1000);
}

/** Format elapsed time as mm:ss for KDS countdown */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
