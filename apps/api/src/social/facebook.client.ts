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
   * Resolve the page metadata for the supplied token. Returns the page
   * name so the Settings UI can show "Connected as <name>". Throws on
   * any non-2xx response — the connect endpoint catches this and
   * surfaces a friendly message.
   */
  async verifyPage(input: VerifyPageInput): Promise<{ pageId: string; pageName: string }> {
    const url = `${GRAPH_BASE}/${encodeURIComponent(input.pageId)}?fields=id,name&access_token=${encodeURIComponent(input.accessToken)}`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (!res.ok || !body.id) {
      const msg = body.error?.message ?? `Facebook verify failed (${res.status})`;
      throw new Error(msg);
    }
    return { pageId: body.id, pageName: body.name ?? input.pageId };
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
