/**
 * In-memory session holder. When a cashier signs in successfully, the main
 * process stores their access/refresh tokens here. Phase 4's fetch shim will
 * read from this module to attach Authorization headers to outbound
 * requests. Tokens are never sent across the IPC bridge.
 *
 * The session does NOT persist across app restarts by design — if the app
 * restarts, cashier must re-enter their PIN. (This is fine for a shared
 * terminal and keeps the threat model simple.)
 */

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string;
  branchName: string;
}

interface Session {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  signedInAt: number;
}

let current: Session | null = null;

export function setSession(s: Omit<Session, 'signedInAt'>): void {
  current = { ...s, signedInAt: Date.now() };
}

export function getSession(): Session | null {
  return current;
}

export function getSessionUser(): AuthenticatedUser | null {
  return current?.user ?? null;
}

export function getAccessToken(): string | null {
  return current?.accessToken ?? null;
}

export function clearSession(): void {
  current = null;
}
