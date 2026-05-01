import { Injectable, Logger } from '@nestjs/common';

/**
 * Facebook Graph API client for page-level posting.
 *
 * v1 supports two operations:
 *   - `verifyPage`  — confirm a token belongs to the given page and
 *                     return the page name for the Settings UI.
 *   - `postPhoto`   — upload an image + caption to the page feed.
 *
 * Uses native fetch (Node 22 builtin) with `multipart/form-data`
 * via the `FormData` global. No external HTTP library — same posture
 * as the SMS service.
 *
 * Token model: long-lived page access token, copied in by the owner.
 * Full FB Login OAuth flow is v2.
 */

interface VerifyPageInput {
  pageId: string;
  accessToken: string;
}

interface PostPhotoInput {
  pageId: string;
  accessToken: string;
  imageBuffer: Buffer;
  caption: string;
}

interface FbPostResponse {
  id: string;
  /** post_id is the page-feed-scoped id we link to. */
  postId: string;
}

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

@Injectable()
export class FacebookClient {
  private readonly log = new Logger(FacebookClient.name);

  /**
   * Resolve the page metadata for the supplied token AND return a
   * page-specific access token suitable for posting to /photos.
   *
   * Admins typically paste a USER token from Graph API Explorer with
   * `pages_manage_posts` etc. checked. That user token can READ the
   * page (pageId verify works) but POSTING to /{page-id}/photos with
   * a user token returns "(#200) publish_actions deprecated" — the
   * Graph API rejects user tokens at publish-time even when the user
   * has the right page scopes.
   *
   * Walk through the user's pages via /me/accounts; each entry
   * carries a page-native access_token that's the right kind for
   * publishing. We pick the one matching the supplied pageId and
   * return it; if none match, we fall back to the supplied token
   * (caller may have already pasted a page-native token).
   */
  async verifyPage(input: VerifyPageInput): Promise<{ pageId: string; pageName: string; pageAccessToken: string }> {
    // First: confirm the page id is reachable with this token. This
    // also catches expired/wrong-scope tokens up front with a clean
    // error.
    const url = `${GRAPH_BASE}/${encodeURIComponent(input.pageId)}?fields=id,name&access_token=${encodeURIComponent(input.accessToken)}`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (!res.ok || !body.id) {
      const msg = body.error?.message ?? `Facebook verify failed (${res.status})`;
      throw new Error(msg);
    }
    const pageName = body.name ?? input.pageId;

    // Second: derive the page-native token. /me/accounts returns
    // every page the supplied token can manage, each with its own
    // access_token field. If the supplied token IS already a page
    // token, /me/accounts may 200 with one entry — same outcome.
    let pageAccessToken = input.accessToken;
    try {
      const accUrl = `${GRAPH_BASE}/me/accounts?fields=id,name,access_token&limit=200&access_token=${encodeURIComponent(input.accessToken)}`;
      const accRes = await fetch(accUrl);
      const accBody = (await accRes.json().catch(() => ({}))) as {
        data?: Array<{ id?: string; name?: string; access_token?: string }>;
      };
      const match = accBody.data?.find((p) => p.id === input.pageId && p.access_token);
      if (match?.access_token) {
        pageAccessToken = match.access_token;
      }
      // If no match — the supplied token IS the page token already
      // (or the user lacks pages_show_list). Posting with the
      // original token will surface a real error to the admin.
    } catch {
      // Network / parse error — fall back to the supplied token; the
      // posting cron will retry with whatever we have.
    }

    return { pageId: body.id, pageName, pageAccessToken };
  }

  /**
   * Upload a photo + caption to the page feed. The Graph API returns
   * `{ id, post_id }`; we surface `post_id` (the page-feed-scoped id)
   * for the "View on Facebook" link in admin.
   */
  async postPhoto(input: PostPhotoInput): Promise<FbPostResponse> {
    const url = `${GRAPH_BASE}/${encodeURIComponent(input.pageId)}/photos`;
    const form = new FormData();
    form.append('caption', input.caption);
    form.append('access_token', input.accessToken);
    // FormData expects a Blob; native Node 22 supports it. Convert
    // the Buffer to a Blob with a JPEG MIME so FB recognises it.
    const blob = new Blob([new Uint8Array(input.imageBuffer)], { type: 'image/jpeg' });
    form.append('source', blob, 'discount.jpg');

    const res = await fetch(url, { method: 'POST', body: form });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      post_id?: string;
      error?: { message?: string };
    };
    if (!res.ok || !body.id) {
      const msg = body.error?.message ?? `Facebook post failed (${res.status})`;
      this.log.warn(`postPhoto failed: ${msg}`);
      throw new Error(msg);
    }
    return { id: body.id, postId: body.post_id ?? body.id };
  }
}
