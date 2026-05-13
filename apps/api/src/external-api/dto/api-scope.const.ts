/// Scopes are the unit of authorization on external API keys. Each route
/// declares the scope it requires via @Scopes(...); ScopesGuard enforces.
/// New scopes can be added freely — existing keys keep working because
/// the array column on ExternalApiKey is unconstrained.
export const API_SCOPES = [
  'business:read',
  'reports:read',
  'finance:read',
  'inventory:read',
  'menu:read',
  'customers:read',
  'loyalty:read',
  'marketing:read',
  'marketing:write',
  'reviews:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
