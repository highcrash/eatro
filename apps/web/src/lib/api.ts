// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((error as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMenu: <T>(branchId: string) => request<T>(`/public/menu/${branchId}`),
  getBranches: <T>() => request<T>('/public/branches'),
  placeOrder: <T>(branchId: string, body: unknown) =>
    request<T>('/orders/qr', { method: 'POST', headers: { 'X-Branch-Id': branchId }, body: JSON.stringify(body) }),
  getOrderStatus: <T>(orderId: string) => request<T>(`/orders/qr/${orderId}/status`),
  getJson: <T>(path: string) => request<T>(path),
};
