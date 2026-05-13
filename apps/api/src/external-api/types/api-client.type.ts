import type { ApiScope } from '../dto/api-scope.const';

/// Attached to req.apiClient by ApiKeyGuard after successful auth. Mirrors
/// the JwtPayload shape used by staff routes so downstream code reads
/// from a single conceptual "current actor" — but the two are distinct
/// types and never interchangeable.
export interface ApiClient {
  keyId: string;
  branchId: string;
  scopes: ApiScope[];
}

declare module 'express' {
  interface Request {
    apiClient?: ApiClient;
  }
}
