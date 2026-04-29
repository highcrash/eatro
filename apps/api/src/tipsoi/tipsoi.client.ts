import { Injectable, Logger } from '@nestjs/common';

/**
 * Shape of a single attendance log returned by Tipsoi's /api/v1/logs.
 * Documented in the vendor PDF — fields used by the sync service kept
 * required, optional fields kept narrow so a stale device upload
 * doesn't crash the parser.
 */
export interface TipsoiLog {
  sync_time: string;          // "YYYY-MM-DD HH:mm:ss" — server-side received timestamp
  logged_time: string;        // "YYYY-MM-DD HH:mm:ss" — actual clock event time at the device
  type: 'card' | 'fingerprint' | 'face' | string;
  uid: string;                // unique per log — used as syncedFromUid for idempotency
  device_identifier: string;
  location?: string;
  person_identifier: string;  // e.g. "Ahmed-1234" — maps to Staff.tipsoiPersonId
  rfid?: string;
  primary_display_text?: string;
  secondary_display_text?: string;
}

interface TipsoiLogsResponse {
  data: TipsoiLog[];
  links?: { next?: string | null };
  meta?: { current_page?: number; last_page?: number; total?: number };
}

interface TipsoiPeopleEntry {
  identifier: string;
  rfid?: string;
  primary_display_text?: string;
  secondary_display_text?: string;
  description?: string;
  updated_at?: string;
}

/**
 * Thin HTTP wrapper around Tipsoi's /api/v1 endpoints. Native `fetch`
 * (same pattern as [sms.service.ts](apps/api/src/sms/sms.service.ts))
 * — no axios, no extra deps. The client is stateless; the sync service
 * passes apiUrl + apiToken on every call so a single Restora install
 * could in principle support multiple branches with different Tipsoi
 * accounts.
 */
@Injectable()
export class TipsoiClient {
  private readonly logger = new Logger('TipsoiClient');

  /**
   * Pull attendance logs for a date range, following pagination until
   * exhausted. Tipsoi caps `per_page` at 500; we walk every page so
   * the caller doesn't have to know about the cursor shape. Returns
   * the flat list of logs in whatever order Tipsoi sent them — the
   * sync service does its own grouping by (staff, shiftDate).
   */
  async fetchLogs(opts: {
    apiUrl: string;
    apiToken: string;
    /** "YYYY-MM-DD HH:mm:ss" — Tipsoi expects 24h, no timezone. */
    start: string;
    end: string;
    perPage?: number;
  }): Promise<TipsoiLog[]> {
    const all: TipsoiLog[] = [];
    let page = 1;
    const perPage = opts.perPage ?? 500;
    // Hard cap on pagination so a runaway response can't infinite-loop.
    const MAX_PAGES = 100;
    while (page <= MAX_PAGES) {
      const url = new URL(`${opts.apiUrl.replace(/\/$/, '')}/api/v1/logs`);
      url.searchParams.set('start', opts.start);
      url.searchParams.set('end', opts.end);
      url.searchParams.set('api_token', opts.apiToken);
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      // criteria=sync_time (default) — covers retroactive uploads.
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Tipsoi /logs ${res.status}: ${body.slice(0, 200) || res.statusText}`);
      }
      const json = (await res.json()) as TipsoiLogsResponse;
      if (Array.isArray(json.data)) all.push(...json.data);
      const totalPages = json.meta?.last_page ?? page;
      if (!json.links?.next || page >= totalPages) break;
      page += 1;
    }
    if (page > MAX_PAGES) {
      this.logger.warn(`Tipsoi pagination hit ${MAX_PAGES}-page cap; results may be truncated. Narrow the time window.`);
    }
    return all;
  }

  /**
   * Smoke-test a token against /api/v1/people. Cheap GET that returns
   * 200 + JSON only when the token is valid; we surface its outcome
   * to the admin Settings UI as a "Test connection" button so they
   * can verify a freshly-pasted token before saving.
   */
  async testToken(opts: { apiUrl: string; apiToken: string }): Promise<{ ok: boolean; message: string; peopleCount?: number }> {
    try {
      const url = new URL(`${opts.apiUrl.replace(/\/$/, '')}/api/v1/people`);
      url.searchParams.set('api_token', opts.apiToken);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, message: `${res.status} ${res.statusText}: ${body.slice(0, 200)}` };
      }
      const json = (await res.json()) as TipsoiPeopleEntry[] | { data: TipsoiPeopleEntry[] };
      const count = Array.isArray(json) ? json.length : json?.data?.length ?? 0;
      return { ok: true, message: `Connected — ${count} people configured on Tipsoi.`, peopleCount: count };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
