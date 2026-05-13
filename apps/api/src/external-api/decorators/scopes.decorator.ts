import { SetMetadata } from '@nestjs/common';

import type { ApiScope } from '../dto/api-scope.const';

export const SCOPES_KEY = 'apiScopes';

/// Mark a controller or handler with the scopes a caller must hold to
/// reach it. Multiple scopes are AND-combined (caller needs all).
export const Scopes = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes);
