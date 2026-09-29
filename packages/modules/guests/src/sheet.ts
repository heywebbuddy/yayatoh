import { DomainError } from '@yayatoh/kernel';
import {
  assertPublicUrl,
  nodeTransport,
  type ResolvedAddress,
  type Resolver,
  type Transport,
} from '@yayatoh/platform/ssrf';
import { parseSheetUrl, sheetExportUrl } from './domain/import.ts';

/**
 * Reading a Google Sheet shared as "anyone with the link" (P4-7, M4.1b): the CSV export, once,
 * through the SSRF guard. Only docs.google.com links are accepted; redirects may only go to
 * Google's own content hosts, and every hop is checked again (public addresses only, pinned).
 * No OAuth and no stored token; the link is not kept after the read. Server-only
 * (`@yayatoh/guests/sheet`), because the guard needs node:dns.
 */
export interface SheetFetchOptions {
  /** Tests: a fake network. */
  readonly transport?: Transport;
  readonly resolver?: Resolver;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export const SHEET_ERRORS = [
  'sheet_url',
  'sheet_private',
  'sheet_not_found',
  'sheet_unavailable',
  'sheet_blocked',
  'too_large',
] as const;
export type SheetError = (typeof SHEET_ERRORS)[number];

const fail = (reason: SheetError): never => {
  throw new DomainError('validation_failed', 'The sheet could not be read', { field: 'sheetUrl', reason });
};

const googleHost = (host: string) =>
  host === 'docs.google.com' || /^[a-z0-9-]+\.googleusercontent\.com$/.test(host);

/** The sheet's first (or linked) tab as CSV bytes. */
export async function fetchGoogleSheetCsv(raw: string, opts: SheetFetchOptions = {}): Promise<Uint8Array> {
  const sheet = parseSheetUrl(raw);
  if (!sheet) return fail('sheet_url');
  const transport = opts.transport ?? nodeTransport;
  let target = new URL(sheetExportUrl(sheet));
  for (let hop = 0; hop <= 4; hop++) {
    if (target.protocol !== 'https:') return fail('sheet_unavailable');
    // Google sends a private sheet's visitors to its sign-in page.
    if (target.hostname === 'accounts.google.com') return fail('sheet_private');
    if (!googleHost(target.hostname)) return fail('sheet_unavailable');
    let checked: { url: URL; addresses: readonly ResolvedAddress[] };
    try {
      checked = await assertPublicUrl(target, { allowedPorts: [443], resolver: opts.resolver });
    } catch {
      return fail('sheet_blocked');
    }
    let res: Awaited<ReturnType<Transport>>;
    try {
      res = await transport({
        url: checked.url,
        address: checked.addresses[0] as ResolvedAddress,
        method: 'GET',
        headers: { 'user-agent': 'Yayatoh/2.0 (+https://yayatoh.com)', accept: 'text/csv' },
        timeoutMs: opts.timeoutMs ?? 10_000,
        maxBytes: opts.maxBytes ?? 5_000_000,
      });
    } catch (err) {
      return fail(
        err instanceof DomainError && /large/i.test(err.message) ? 'too_large' : 'sheet_unavailable',
      );
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      target = new URL(location, checked.url);
      continue;
    }
    if (res.status === 401 || res.status === 403) return fail('sheet_private');
    if (res.status === 404 || res.status === 400 || res.status === 410) return fail('sheet_not_found');
    if (res.status !== 200) return fail('sheet_unavailable');
    // A sign-in or error page instead of the export.
    if (/text\/html/i.test(res.headers['content-type'] ?? '')) return fail('sheet_private');
    return res.body;
  }
  return fail('sheet_unavailable');
}
