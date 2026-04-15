import { session } from 'electron';
import { readConfig } from './config/store';

/**
 * The POS renders `<img src="/uploads/foo.webp" />` for locally-uploaded
 * images, assuming the API server is on the same origin. In the desktop
 * shell the origin is either the electron-vite dev server or a file://
 * URL — neither of which serves uploads. This webRequest filter redirects
 * any request whose path starts with `/uploads/` to the paired server.
 *
 * Absolute image URLs (e.g. DO Spaces `https://sgp1.digitaloceanspaces.com/...`)
 * are untouched — they work on their own.
 *
 * We cache the server URL in-process; on pairing / unpairing the cache is
 * refreshed via refreshUploadProxyServer(). Worst case the cache is stale
 * and a single image fails — next load will hit the fresh config.
 */

let cachedServerUrl: string | null = null;

export async function refreshUploadProxyServer(): Promise<void> {
  const cfg = await readConfig();
  cachedServerUrl = cfg?.serverUrl ?? null;
}

export async function installUploadProxy(): Promise<void> {
  await refreshUploadProxyServer();
  console.log(`[upload-proxy] installed; server = ${cachedServerUrl ?? '(unpaired)'}`);

  // Broad filter — filter precisely in the handler. Some requests
  // (ws://, file://, etc.) are emitted by the renderer and we want to
  // inspect them all during debugging.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      try {
        // Only image/video/audio subresources — leave XHR, fetch, navigation alone.
        const resourceType = details.resourceType;
        if (resourceType !== 'image' && resourceType !== 'media' && resourceType !== 'font') {
          return callback({});
        }

        const target = cachedServerUrl;
        if (!target) return callback({});

        let parsed: URL;
        try { parsed = new URL(details.url); } catch { return callback({}); }
        if (!parsed.pathname.startsWith('/uploads/')) return callback({});

        const targetParsed = new URL(target);
        if (parsed.host === targetParsed.host && parsed.protocol === targetParsed.protocol) {
          return callback({});
        }
        const redirectURL = `${target.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`;
        console.log(`[upload-proxy] ${details.url}  →  ${redirectURL}`);
        callback({ redirectURL });
      } catch (err) {
        console.warn(`[upload-proxy] handler error: ${(err as Error).message}`);
        callback({});
      }
    },
  );
}
