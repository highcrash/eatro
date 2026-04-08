// ─── Roles ────────────────────────────────────────────────────────────────────

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'WAITER';

// ─── Auth DTOs ────────────────────────────────────────────────────────────────

export interface LoginDto {
  email: string;
  password: string;
  branchId?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  branchId: string;
  branchName: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  branchId: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface VerifyCredentialsDto {
  email: string;
  password: string;
}

export interface VerifyCredentialsResponse {
  id: string;
  name: string;
  role: UserRole;
}
