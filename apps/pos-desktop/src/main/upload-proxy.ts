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

/**
 * Only these hosts count as "the renderer's own origin" — i.e. relative URL
 * resolutions for dev-server / file:// pages. Requests to any other host
 * (DO Spaces CDN, any real service) pass through unchanged.
 */
function isRendererOriginHost(host: string): boolean {
  if (!host) return false;          // file:// URLs
  if (host === 'localhost' || host.startsWith('localhost:')) return true;
  if (host === '127.0.0.1' || host.startsWith('127.0.0.1:')) return true;
  return false;
}

export async function installUploadProxy(): Promise<void> {
  await refreshUploadProxyServer();
  console.log(`[upload-proxy] installed; server = ${cachedServerUrl ?? '(unpaired)'}`);

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      try {
        const resourceType = details.resourceType;
        if (resourceType !== 'image' && resourceType !== 'media' && resourceType !== 'font') {
          return callback({});
        }

        const target = cachedServerUrl;
        if (!target) return callback({});

        let parsed: URL;
        try { parsed = new URL(details.url); } catch { return callback({}); }
        if (!parsed.pathname.startsWith('/uploads/')) return callback({});

        // CRITICAL: only redirect requests aimed at the renderer's own
        // origin (dev server or file://). Absolute URLs to DO Spaces /
        // any other CDN are already valid — don't touch them.
        if (parsed.protocol !== 'file:' && !isRendererOriginHost(parsed.host)) {
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
