// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
const PUBLIC_BASE = `${API_BASE}/public`;
const ORDER_BASE = `${API_BASE}/orders/qr`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((error as { message?: string }).message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

async function requestWithBranch<T>(url: string, branchId: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Branch-Id': branchId,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((error as { message?: string }).message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(`${PUBLIC_BASE}${path}`),
  postOrder: <T>(branchId: string, body: unknown) =>
    requestWithBranch<T>(ORDER_BASE, branchId, { method: 'POST', body: JSON.stringify(body) }),
  getOrderStatus: <T>(orderId: string) =>
    request<T>(`${ORDER_BASE}/${orderId}/status`),
  addItems: <T>(orderId: string, branchId: string, items: unknown) =>
    requestWithBranch<T>(`${ORDER_BASE}/${orderId}/items`, branchId, { method: 'POST', body: JSON.stringify(items) }),
  cancelItem: <T>(orderId: string, itemId: string, branchId: string) =>
    requestWithBranch<T>(`${ORDER_BASE}/${orderId}/items/${itemId}/cancel`, branchId, { method: 'POST' }),
  requestBill: <T>(orderId: string, branchId: string) =>
    requestWithBranch<T>(`${ORDER_BASE}/${orderId}/request-bill`, branchId, { method: 'POST' }),
  applyCoupon: <T>(orderId: string, branchId: string, code: string) =>
    requestWithBranch<T>(`${ORDER_BASE}/${orderId}/apply-coupon`, branchId, { method: 'POST', body: JSON.stringify({ code }) }),
  removeCoupon: <T>(orderId: string, branchId: string) =>
    requestWithBranch<T>(`${ORDER_BASE}/${orderId}/remove-coupon`, branchId, { method: 'POST' }),
  submitReview: <T>(branchId: string, data: { orderId: string; customerId?: string; foodScore: number; serviceScore: number; atmosphereScore: number; priceScore: number; notes?: string }) =>
    requestWithBranch<T>('/api/v1/customers/reviews', branchId, { method: 'POST', body: JSON.stringify(data) }),
  // Customer auth
  requestCustomerOtp: <T>(branchId: string, phone: string) =>
    requestWithBranch<T>('/api/v1/customers/auth/request-otp', branchId, { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyCustomerOtp: <T>(branchId: string, phone: string, otp: string) =>
    requestWithBranch<T>('/api/v1/customers/auth/verify-otp', branchId, { method: 'POST', body: JSON.stringify({ phone, otp }) }),
  updateCustomerProfile: <T>(customerId: string, name?: string, email?: string) =>
    request<T>('/api/v1/customers/auth/profile', { method: 'PATCH', body: JSON.stringify({ customerId, name, email }) }),
  getActiveOrder: <T>(branchId: string, customerId: string) =>
    requestWithBranch<T>('/api/v1/customers/auth/active-order', branchId, { method: 'POST', body: JSON.stringify({ customerId }) }),
};
