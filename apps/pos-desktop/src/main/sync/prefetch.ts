import { apiFetch } from './api-proxy';

/**
 * After a cashier signs in, fire off the GETs the POS will need on its first
 * render so they're already in the SQLite response_cache by the time the
 * renderer mounts. That way, if the network drops between sign-in and the
 * first POS render, the POS still has data to work with.
 *
 * Best-effort: every call is awaited but failures are swallowed. apiFetch
 * writes successful responses to the cache for us.
 */
const STARTUP_PATHS: string[] = [
  '/branding',
  '/branch-settings',
  '/menu',
  '/menu/categories',
  '/tables',
  '/staff',
  '/work-periods/current',
  '/payment-methods',
  '/discounts/active',
  // Cooking stations / kitchen sections — the desktop needs these cached
  // so it can group kitchen tickets per section and route to each
  // section's configured printer, even when the network blips during
  // a busy service.
  '/cooking-stations',
];

export async function prefetchStartupData(): Promise<void> {
  await Promise.all(
    STARTUP_PATHS.map((path) =>
      apiFetch({ method: 'GET', path })
        .catch((err) => console.warn(`[prefetch] ${path} failed:`, (err as Error).message)),
    ),
  );
}
