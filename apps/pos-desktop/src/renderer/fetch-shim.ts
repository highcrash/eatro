/**
 * Monkey-patch the global `fetch` so every request to the paired Restora API
 * gets routed through the Electron main process via IPC.
 *
 * Why: the renderer runs with `contextIsolation: true` at a file:// or
 * dev-server origin, so `fetch('/api/v1/...')` can't reach the real server.
 * More importantly, main owns the auth tokens, online detector, outbox, and
 * Idempotency-Key minting — routing every call through it is the only way
 * those pieces work end-to-end.
 *
 * The shim is selective: requests that don't start with `/api/v1` (or the
 * full URL variant used in some code paths) pass through to the real fetch
 * untouched. CSS and font downloads still work.
 */

const realFetch = window.fetch.bind(window);

function targetsApi(url: string): boolean {
  if (url.startsWith('/api/v1')) return true;
  try {
    const u = new URL(url, window.location.href);
    return u.pathname.startsWith('/api/v1');
  } catch {
    return false;
  }
}

function stripBase(url: string): string {
  if (url.startsWith('/api/v1')) return url.slice('/api/v1'.length);
  try {
    const u = new URL(url, window.location.href);
    return u.pathname.slice('/api/v1'.length) + (u.search || '');
  } catch {
    return url;
  }
}

function headerObj(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key] = value; });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

async function parseBody(body: BodyInit | null | undefined): Promise<unknown> {
  if (body == null) return undefined;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return body; }
  }
  if (body instanceof Blob) return JSON.parse(await body.text());
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
  return body as unknown;
}

function toResponse(status: number, body: unknown): Response {
  const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installFetchShim(): void {
  if (!window.desktop?.api?.fetch) {
    // Running in plain Vite browser preview — leave fetch alone so developers
    // can still iterate on the renderer without Electron.
    console.warn('[desktop-shim] window.desktop unavailable; fetch shim disabled');
    return;
  }

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!targetsApi(url)) return realFetch(input as RequestInfo, init);

    const path = stripBase(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await parseBody(init?.body ?? undefined);
    const headers = headerObj(init?.headers);

    try {
      const result = await window.desktop.api.fetch({
        method,
        path,
        body,
        headers,
      });
      return toResponse(result.status, result.body);
    } catch (err) {
      return toResponse(0, { message: (err as Error).message });
    }
  };
}
