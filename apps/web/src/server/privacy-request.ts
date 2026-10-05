import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  GUEST_CODE_TTL_MS,
  normalizeGuestEmail,
  requestGuestChallenge,
  verifyGuestChallenge,
} from '@yayatoh/orders';
import { signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import {
  DSAR_ARCHIVE_DAYS,
  selfArchiveFileQuery,
  selfReceiptQuery,
  submitSelfRequestCommand,
} from '@yayatoh/privacy';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import {
  browserState,
  forgetPendingChallenge,
  guestHost,
  guestLimits,
  pendingChallenge,
  rememberPendingChallenge,
  sendGuestEmail,
} from './guest.ts';
import { ports } from './ports.ts';

/**
 * Self-service data-subject requests (M6.1c). A person proves their address with an emailed code
 * (the M1.5f guest codes: rate limits, attempts, one code at a time, scoped to the org), then the
 * request is opened as a system actor. When staff fulfil it, the person gets a signed link: the
 * archive (7 days) or the erasure receipt. Links name the org by slug and the request by a
 * signed id; they never carry the address.
 */
const system = (orgId: string) =>
  createCtx({ orgId, actor: { type: 'system', name: 'privacy.self-service' } });

const prefix = (locale: string) => (locale === 'en' ? '' : `/${locale}`);

export type SelfKind = 'access' | 'erasure';

/** The org behind a public slug, if it takes requests (active orgs only). */
export async function privacyOrg(slug: string): Promise<{ orgId: string } | null> {
  const r = await resolveOrgSlug(slug);
  return r && r.status === 'active' ? { orgId: r.orgId } : null;
}

export async function sendRequestCode(orgId: string, email: string, kind: SelfKind) {
  const r = await requestGuestChallenge(
    { purpose: 'sign_in', scopeOrgId: orgId, email, browserState: await browserState(true) },
    await guestLimits(),
  );
  if (r.status === 'rate_limited') return r;
  if (r.status === 'sent') {
    await sendGuestEmail({
      kind: 'privacy.request-code',
      to: email,
      locale: await getLocale(),
      orgId,
      params: { code: r.code, minutes: GUEST_CODE_TTL_MS / 60_000, kind },
    });
  }
  await rememberPendingChallenge('privacy', r.challengeId);
  return r;
}

/** Check the code; on success open (or find) the request. */
export async function confirmRequestCode(orgId: string, email: string, code: string, kind: SelfKind) {
  const challengeId = await pendingChallenge('privacy');
  if (!challengeId) return { status: 'expired' as const, attemptsLeft: null };
  const v = await verifyGuestChallenge(
    { challengeId, code, purpose: 'sign_in', scopeOrgId: orgId, email },
    await guestLimits(),
  );
  if (v.status !== 'ok' || !v.email) return { status: v.status, attemptsLeft: v.attemptsLeft };
  await forgetPendingChallenge('privacy');
  const r = await executeCommand(
    submitSelfRequestCommand,
    { email: normalizeGuestEmail(v.email), kind },
    system(orgId),
    ports,
  );
  return { status: 'ok' as const, attemptsLeft: null, ...r };
}

const ARCHIVE = 'dsar-archive';
const RECEIPT = 'dsar-receipt';

/** Email the person their archive or receipt link once staff fulfilled their request. */
export async function notifySelfRequester(input: {
  readonly kind: 'archive' | 'receipt';
  readonly to: string;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly requestId: string;
  readonly until?: Date;
}) {
  const locale = await getLocale();
  const { origin } = await guestHost();
  const base = `${origin}${prefix(locale)}/privacy-request/${input.orgSlug}`;
  if (input.kind === 'archive')
    await sendGuestEmail({
      kind: 'privacy.archive-ready',
      to: input.to,
      locale,
      orgId: input.orgId,
      params: { url: `${base}/archive/${signLinkToken(ARCHIVE, input.requestId)}`, days: DSAR_ARCHIVE_DAYS },
    });
  else
    await sendGuestEmail({
      kind: 'privacy.erasure-done',
      to: input.to,
      locale,
      orgId: input.orgId,
      params: { url: `${base}/receipt/${signLinkToken(RECEIPT, input.requestId)}` },
    });
}

/** The archive behind an emailed link (null: bad link, wrong org, expired). */
export async function selfArchive(orgSlug: string, token: string) {
  const requestId = verifyLinkToken(ARCHIVE, token);
  const org = requestId ? await privacyOrg(orgSlug) : null;
  if (!requestId || !org) return null;
  return executeQuery(selfArchiveFileQuery, { requestId }, system(org.orgId), ports).catch(() => null);
}

/** The receipt behind an emailed link. */
export async function selfReceipt(orgSlug: string, token: string) {
  const requestId = verifyLinkToken(RECEIPT, token);
  const org = requestId ? await privacyOrg(orgSlug) : null;
  if (!requestId || !org) return null;
  return executeQuery(selfReceiptQuery, { requestId }, system(org.orgId), ports).catch(() => null);
}
