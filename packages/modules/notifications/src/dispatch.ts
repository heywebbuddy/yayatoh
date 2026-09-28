import { consentRegivenSinceTx, normalizeEmail } from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { erasedAddressesTx, normalizeAddress, signLinkToken } from '@yayatoh/platform';
import { activeSuspensionsTx, organizationBrandTx } from '@yayatoh/tenancy';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { erasedAddressAllows, erasedMailClass, suppressedReason } from './delivery-rules.ts';
import { kindOf, type MessageKind } from './kinds.ts';
import { decryptParams } from './notifier.ts';
import { preferenceEnabledTx } from './preferences.ts';
import { isValidTimeZone, quietHoursRelease } from './quiet-hours.ts';
import {
  addressSuppressions,
  messages,
  pushDeliveries,
  pushTokens,
  suppressions,
  templateOverrides,
} from './schema.ts';
import { emailLocale, renderMessage } from './templates/render.ts';
import { PLATFORM_SENDER, type PushTransport, type Transports } from './transports.ts';
import { pushTopic, type Urgency } from './web-push.ts';

export const UNSUBSCRIBE_PURPOSE = 'notifications.unsubscribe';
export const MAX_ATTEMPTS = 5;

export interface DispatchDeps {
  readonly transports: Transports;
  /** Public origin for links (unsubscribe, console). */
  readonly appOrigin: string;
  /** Resolves member emails for messages addressed to a user id (identity lives in packages/auth). */
  readonly userEmails?: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Members' preferred languages (M1.10d); member emails render in them, else in English. */
  readonly userLocales?: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
  /** Dev tool only: send messages held for quiet hours now. */
  readonly ignoreQuietHours?: boolean;
  /** Dev tool only: send scheduled messages (reminders) now instead of at their time. */
  readonly includeScheduled?: boolean;
  readonly now?: () => Date;
}

export interface DispatchResult {
  sent: number;
  held: number;
  suppressed: number;
  failed: number;
}

/** The page link (in the recipient's language) and the RFC 8058 one-click endpoint. */
export function unsubscribeUrls(appOrigin: string, messageId: string, locale = 'en') {
  const token = signLinkToken(UNSUBSCRIBE_PURPOSE, messageId);
  const prefix = locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';
  return {
    token,
    page: `${appOrigin}${prefix}/unsubscribe/${token}`,
    oneClick: `${appOrigin}/api/unsubscribe/${token}`,
  };
}

type Row = typeof messages.$inferSelect;

/**
 * Send this org's due messages. Rows are claimed with FOR UPDATE SKIP LOCKED inside the tenant
 * transaction, so two dispatchers running at once (a duplicated job, two worker machines) never
 * pick the same row: each message is handed to a provider once. The policy gate runs per row:
 * the org kill switch, unsubscribes, the recipient's preferences, then quiet hours in the
 * recipient's timezone for non-urgent kinds. A provider error retries with backoff; the fifth
 * failure is final.
 */
export async function dispatchDueTx(
  tx: TenantTx,
  orgId: string,
  deps: DispatchDeps,
  limit = 50,
): Promise<DispatchResult> {
  const now = deps.now?.() ?? new Date();
  const result: DispatchResult = { sent: 0, held: 0, suppressed: 0, failed: 0 };
  const due = await tx
    .select()
    .from(messages)
    .where(
      and(eq(messages.status, 'queued'), deps.includeScheduled ? undefined : lte(messages.sendAfter, now)),
    )
    .orderBy(asc(messages.sendAfter), asc(messages.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (due.length === 0) return result;
  const org = await organizationBrandTx(tx, orgId);
  if (!org) return result;
  const paused = (await activeSuspensionsTx(tx)).has('pause_messaging');
  const needEmails = due.filter((r) => r.channel === 'email' && !r.recipientEmail && r.recipientUserId);
  const memberIds = [...new Set(needEmails.map((r) => r.recipientUserId as string))];
  const emails =
    memberIds.length && deps.userEmails ? await deps.userEmails(memberIds) : new Map<string, string>();
  // Member notifications (no address of their own) render in the member's language, looked up at
  // send time so a change applies to messages already queued.
  const locales =
    memberIds.length && deps.userLocales
      ? await deps.userLocales(memberIds)
      : new Map<string, string | null>();

  // The platform-wide erased-address list (M1.14e), looked up once for this batch.
  const batchEmails = due
    .filter((r) => r.channel === 'email' || r.channel === 'push')
    .map((r) =>
      r.channel === 'push'
        ? r.recipientEmail
        : (r.recipientEmail ?? emails.get(r.recipientUserId ?? '') ?? null),
    )
    .filter((e): e is string => Boolean(e));
  const erased = batchEmails.length ? await erasedAddressesTx(tx, batchEmails) : new Map();

  const update = (row: Row, set: Partial<Row>) =>
    tx
      .update(messages)
      .set({ ...set, updatedAt: now })
      .where(eq(messages.id, row.id));
  const suppress = async (row: Row, reason: string) => {
    await update(row, { status: 'suppressed', reason });
    result.suppressed += 1;
  };

  for (const row of due) {
    const def = kindOf(row.kind);
    const optional = def.category !== 'transactional';
    if (paused && optional) {
      await update(row, { sendAfter: new Date(now.getTime() + 15 * 60_000), reason: 'messaging_paused' });
      result.held += 1;
      continue;
    }
    const email =
      row.channel === 'email' ? (row.recipientEmail ?? emails.get(row.recipientUserId ?? '') ?? null) : null;
    // Bounces and complaints (M1.10d): the address can't or mustn't receive mail, whatever the
    // category, transactional included; the message log shows why.
    const phoneOf = async () => {
      if (row.channel !== 'sms') return null;
      const p = (await decryptParams(orgId, row.paramsCiphertext))._phone;
      return typeof p === 'string' ? p : null;
    };
    const address = email ? normalizeEmail(email) : await phoneOf();
    if (address && row.channel !== 'push') {
      const [blocked] = await tx
        .select({ reason: addressSuppressions.reason })
        .from(addressSuppressions)
        .where(
          and(eq(addressSuppressions.channel, row.channel), eq(addressSuppressions.addressNorm, address)),
        );
      if (blocked) {
        await suppress(row, suppressedReason(blocked.reason));
        continue;
      }
    }
    // Unsubscribes (and a contact blocking the organizer) are per address and category: they stop
    // push to that person too (M1.10e).
    const optedOutAddress = email ?? (row.channel === 'push' ? row.recipientEmail : null);
    // Erased addresses (M1.14e): only order mail, account mail after a new sign-up, and org mail
    // after a new consent in this org. The same gate holds for push to a buyer's devices (M1.10e).
    const erasedEntry = optedOutAddress ? erased.get(normalizeAddress(optedOutAddress)) : undefined;
    if (optedOutAddress && erasedEntry) {
      const mailClass = erasedMailClass(row.kind, def);
      const allowed = erasedAddressAllows({
        mailClass,
        accountLiftedAt: erasedEntry.accountLiftedAt,
        consentRegiven:
          mailClass === 'org' &&
          (await consentRegivenSinceTx(tx, normalizeEmail(optedOutAddress), 'email', erasedEntry.erasedAt)),
      });
      if (!allowed) {
        await suppress(row, 'erased');
        continue;
      }
    }
    if (optional && optedOutAddress) {
      const [s] = await tx
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.emailNorm, normalizeEmail(optedOutAddress)),
            eq(suppressions.category, def.category),
          ),
        );
      if (s) {
        await suppress(row, 'unsubscribed');
        continue;
      }
    }
    if (
      optional &&
      row.recipientUserId &&
      !(await preferenceEnabledTx(
        tx,
        row.recipientUserId,
        def.category,
        row.channel as 'email' | 'sms' | 'push',
      ))
    ) {
      await suppress(row, 'preference');
      continue;
    }
    // Push: the recipient's active devices (members by user, buyers by email) and, for quiet
    // hours, the timezone their most recent device reported.
    const devices = row.channel === 'push' ? await pushDevicesOf(tx, row) : [];
    if (!def.urgent && !deps.ignoreQuietHours) {
      const deviceTz = devices.find((d) => isValidTimeZone(d.timeZone))?.timeZone;
      const tz = deviceTz ?? (isValidTimeZone(row.timeZone) ? row.timeZone : org.timezone);
      const release = quietHoursRelease(now, tz);
      if (release) {
        await update(row, { sendAfter: release, reason: 'quiet_hours' });
        result.held += 1;
        continue;
      }
    }
    try {
      const params = await decryptParams(orgId, row.paramsCiphertext);
      const memberLocale =
        !row.recipientEmail && row.recipientUserId ? locales.get(row.recipientUserId) : undefined;
      const locale = memberLocale ? emailLocale(memberLocale) : row.locale;
      const [override] = await tx
        .select({ subject: templateOverrides.subject, intro: templateOverrides.intro })
        .from(templateOverrides)
        .where(and(eq(templateOverrides.kind, row.kind), eq(templateOverrides.locale, locale)));
      const unsub = optional ? unsubscribeUrls(deps.appOrigin, row.id, emailLocale(locale)) : null;
      const href = typeof params._href === 'string' && params._href ? params._href : null;
      // Member alerts link into the console: their button uses the same link as push (M1.9e).
      const consoleLink = href ? `${deps.appOrigin}/o/${org.slug}${href}` : null;
      const rendered = renderMessage({
        kind: row.kind as MessageKind,
        locale,
        params: consoleLink && !params.url ? { ...params, url: consoleLink } : params,
        // The brand kit logo (M1.4e) as an absolute URL on the app origin (email clients fetch it).
        org: { ...org, logoUrl: org.logoPath ? `${deps.appOrigin.replace(/\/$/, '')}${org.logoPath}` : null },
        recipientName: row.recipientName,
        unsubscribeUrl: unsub?.page ?? null,
        override: override ?? null,
      });
      // The message's own link: its page (tickets, order), the conversation (announcements,
      // replies) or, for member notifications, the console page.
      const link =
        typeof params.url === 'string' && params.url
          ? params.url
          : typeof params.replyUrl === 'string' && params.replyUrl
            ? params.replyUrl
            : consoleLink;
      let providerMessageId: string;
      if (row.channel === 'email') {
        if (!email) {
          await update(row, { status: 'failed', reason: 'no_address', attempts: row.attempts + 1 });
          result.failed += 1;
          continue;
        }
        const headers: Record<string, string> = { 'X-Yayatoh-Message': row.id };
        if (unsub) {
          // RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click` to this URL.
          headers['List-Unsubscribe'] = `<${unsub.oneClick}>`;
          headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
        }
        ({ providerMessageId } = await deps.transports.email.send({
          from: { name: org.name, address: PLATFORM_SENDER },
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers,
          idempotencyKey: row.id,
        }));
      } else if (row.channel === 'push') {
        const push = deps.transports.push;
        if (!push) throw new Error('no push adapter configured');
        const outcome = await sendPushTx(tx, orgId, row, devices, push, now, {
          title: rendered.subject,
          body: typeof params.body === 'string' && params.body ? params.body : rendered.preview,
          url: link,
          lang: rendered.lang,
          dir: rendered.dir,
          ...pushOptions(row.kind as MessageKind),
        });
        if (outcome.kind === 'retry') {
          const attempts = row.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await update(row, {
              attempts,
              status: 'failed',
              reason: 'provider_error',
              lastError: 'push: rate limited',
            });
            result.failed += 1;
          } else {
            const backoff = 2 ** attempts * 60_000;
            await update(row, {
              attempts,
              reason: 'retrying',
              lastError: `push: HTTP ${outcome.status ?? 'network'}`,
              sendAfter: new Date(now.getTime() + Math.max(backoff, outcome.retryAfterMs ?? 0)),
            });
            result.held += 1;
          }
          continue;
        }
        if (outcome.kind === 'none') {
          await suppress(row, 'no_device');
          continue;
        }
        if (outcome.kind === 'rejected') {
          await update(row, {
            status: 'failed',
            reason: 'provider_error',
            attempts: row.attempts + 1,
            lastError: 'push: refused by the push service',
          });
          result.failed += 1;
          continue;
        }
        providerMessageId = outcome.providerMessageId;
      } else {
        const sms = deps.transports.sms;
        const phone = typeof params._phone === 'string' ? params._phone : null;
        if (!sms) throw new Error('no SMS adapter configured');
        if (!phone) {
          await update(row, { status: 'failed', reason: 'no_address', attempts: row.attempts + 1 });
          result.failed += 1;
          continue;
        }
        ({ providerMessageId } = await sms.send({
          to: phone,
          body: link
            ? `${rendered.subject}\n${rendered.preview}\n${link}`
            : `${rendered.subject}\n${rendered.preview}`,
          idempotencyKey: row.id,
        }));
      }
      await update(row, {
        status: 'sent',
        locale,
        sentAt: now,
        providerMessageId: providerMessageId.slice(0, 500),
        subject: rendered.subject.slice(0, 300),
        attempts: row.attempts + 1,
        reason: null,
        lastError: null,
      });
      result.sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await update(row, {
        attempts,
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ...(final
          ? { status: 'failed', reason: 'provider_error' }
          : { sendAfter: new Date(now.getTime() + 2 ** attempts * 60_000), reason: 'retrying' }),
      });
      if (final) result.failed += 1;
      else result.held += 1;
    }
  }
  return result;
}

type Device = typeof pushTokens.$inferSelect;

/** The recipient's active push devices, most recently seen first. */
async function pushDevicesOf(tx: TenantTx, row: Row): Promise<Device[]> {
  const owners = [
    ...(row.recipientUserId ? [eq(pushTokens.userId, row.recipientUserId)] : []),
    ...(row.recipientEmail ? [eq(pushTokens.emailNorm, normalizeEmail(row.recipientEmail))] : []),
  ];
  if (owners.length === 0) return [];
  return tx
    .select()
    .from(pushTokens)
    .where(and(or(...owners), isNull(pushTokens.disabledAt)))
    .orderBy(desc(pushTokens.lastSeenAt), asc(pushTokens.id));
}

/** How long a push may wait on the push service, and how urgently it is delivered (RFC 8030). */
export function pushOptions(kind: MessageKind): { ttlSeconds: number; urgency: Urgency } {
  if (kind === 'notifications.test') return { ttlSeconds: 300, urgency: 'high' };
  if (kind === 'events.reminder') return { ttlSeconds: 12 * 3600, urgency: 'normal' };
  return kindOf(kind).urgent
    ? { ttlSeconds: 4 * 3600, urgency: 'high' }
    : { ttlSeconds: 86_400, urgency: 'normal' };
}

export type PushRowOutcome =
  | { readonly kind: 'sent'; readonly providerMessageId: string }
  | { readonly kind: 'retry'; readonly status: number | null; readonly retryAfterMs: number | null }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'none' };

/**
 * What a push message's devices add up to: sent once any device got it and none waits for a
 * retry; retry while any device was rate limited (the others keep their `sent` log row and are
 * skipped next time, so nobody gets it twice); rejected when every live device refused it; none
 * when no device is left (all expired).
 */
export function pushRowOutcome(
  deliveries: ReadonlyArray<{
    status: 'sent' | 'expired' | 'rejected' | 'retrying';
    providerMessageId?: string | null;
    httpStatus?: number | null;
    retryAfterMs?: number | null;
  }>,
): PushRowOutcome {
  const retrying = deliveries.filter((d) => d.status === 'retrying');
  if (retrying.length > 0)
    return {
      kind: 'retry',
      status: retrying[0]?.httpStatus ?? null,
      retryAfterMs: Math.max(0, ...retrying.map((d) => d.retryAfterMs ?? 0)) || null,
    };
  const sent = deliveries.filter((d) => d.status === 'sent');
  if (sent.length > 0)
    return { kind: 'sent', providerMessageId: sent.map((d) => d.providerMessageId ?? 'push').join(',') };
  if (deliveries.some((d) => d.status === 'rejected')) return { kind: 'rejected' };
  return { kind: 'none' };
}

/**
 * Send one push message to each of the recipient's devices it has not reached yet, recording
 * every attempt in `push_deliveries`. Expired subscriptions (404/410) are pruned (disabled).
 */
async function sendPushTx(
  tx: TenantTx,
  orgId: string,
  row: Row,
  devices: readonly Device[],
  push: PushTransport,
  now: Date,
  content: {
    title: string;
    body: string;
    url: string | null;
    lang: string;
    dir: 'ltr' | 'rtl';
    ttlSeconds: number;
    urgency: Urgency;
  },
): Promise<PushRowOutcome> {
  const earlier = devices.length
    ? await tx
        .select()
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.messageId, row.id),
            inArray(
              pushDeliveries.pushTokenId,
              devices.map((d) => d.id),
            ),
          ),
        )
    : [];
  const byToken = new Map(earlier.map((d) => [d.pushTokenId, d]));
  const topic = pushTopic(row.id);
  const results: Parameters<typeof pushRowOutcome>[0][number][] = [];
  for (const d of devices) {
    const prior = byToken.get(d.id);
    if (prior && prior.status !== 'retrying') {
      results.push({
        status: prior.status as 'sent' | 'expired' | 'rejected',
        providerMessageId: prior.providerMessageId,
      });
      continue;
    }
    const r = await push.send({
      platform: d.platform as 'fcm' | 'apns' | 'webpush',
      token: d.token,
      keys: d.p256dh && d.authSecret ? { p256dh: d.p256dh, auth: d.authSecret } : null,
      ...content,
      topic,
      idempotencyKey: `${row.id}:${d.id}`,
    });
    const status =
      'providerMessageId' in r
        ? ('sent' as const)
        : r.error === 'invalid_token'
          ? ('expired' as const)
          : r.error === 'retry'
            ? ('retrying' as const)
            : ('rejected' as const);
    const providerMessageId = 'providerMessageId' in r ? r.providerMessageId.slice(0, 200) : null;
    const httpStatus = 'error' in r ? (r.status ?? null) : null;
    await tx
      .insert(pushDeliveries)
      .values({
        orgId,
        messageId: row.id,
        pushTokenId: d.id,
        platform: d.platform,
        status,
        httpStatus,
        providerMessageId,
        sentAt: status === 'sent' ? now : null,
      })
      .onConflictDoUpdate({
        target: [pushDeliveries.orgId, pushDeliveries.messageId, pushDeliveries.pushTokenId],
        set: {
          status,
          httpStatus,
          providerMessageId,
          sentAt: status === 'sent' ? now : null,
          attempts: (prior?.attempts ?? 0) + 1,
          updatedAt: now,
        },
      });
    // Gone for good (FCM UNREGISTERED, APNs 410, web push 404/410): prune the subscription.
    if (status === 'expired')
      await tx.update(pushTokens).set({ disabledAt: now, updatedAt: now }).where(eq(pushTokens.id, d.id));
    results.push({
      status,
      providerMessageId,
      httpStatus,
      retryAfterMs: 'error' in r && r.error === 'retry' ? (r.retryAfterMs ?? null) : null,
    });
  }
  return pushRowOutcome(results);
}

/** One org's dispatch in its own tenant transaction (worker tick, dev drain). */
export function dispatchDue(orgId: string, deps: DispatchDeps, limit = 50): Promise<DispatchResult> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'notifications.dispatcher' } });
  return withTenant(ctx, (tx) => dispatchDueTx(tx, orgId, deps, limit));
}
