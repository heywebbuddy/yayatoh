import { RTL_LOCALES } from '@yayatoh/contracts';
import { consentRegivenSinceTx, normalizeEmail } from '@yayatoh/crm';
import { isForeignKeyViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { erasedAddressesTx, normalizeAddress, signLinkToken } from '@yayatoh/platform';
import { activeSuspensionsTx, organizationBrandTx } from '@yayatoh/tenancy';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { erasedAddressAllows, erasedMailClass, suppressedReason } from './delivery-rules.ts';
import { emailIdentityTx } from './email-identity.ts';
import { fallbackTx, isFallbackReason } from './fallback.ts';
import { kindOf, type MessageKind, whatsappCategoryOf } from './kinds.ts';
import { decryptParams } from './notifier.ts';
import type { QuotaChannel } from './policy/config.ts';
import { createGateState, type GateFacts, runPolicyPhase } from './policy/gate.ts';
import type { Verdict } from './policy/rules.ts';
import { smsSegments } from './policy/sms-segments.ts';
import { preferenceEnabledTx } from './preferences.ts';
import { type HealthTick, recordProviderHealth } from './provider-health.ts';
import { errorProvider, isProviderRejection, type RejectionCode } from './providers/types.ts';
import { isValidTimeZone, quietHoursRelease } from './quiet-hours.ts';
import {
  addressSuppressions,
  MESSAGE_PROVIDERS,
  messages,
  pushDeliveries,
  pushTokens,
  suppressions,
  templateOverrides,
} from './schema.ts';
import { orgSendersTx } from './senders.ts';
import { renderStoredContent, type StoredContent, storedContentTx } from './stored-content.ts';
import {
  EMAIL_MESSAGES,
  emailLocale,
  type RenderedMessage,
  renderMessage,
  smsText,
} from './templates/render.ts';
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

/** A provider's permanent refusal as the message log's reason (M3.5b). */
export const REJECTION_REASONS: Readonly<Record<RejectionCode, string>> = {
  not_on_channel: 'not_on_whatsapp',
  invalid_address: 'invalid_number',
  opted_out: 'opted_out',
  rejected: 'provider_error',
};

/** The domain part of a sender address (M3.8b: deliverability per sending domain). */
export const senderDomainOf = (address: string): string | null => {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return domain.length >= 4 && domain.length <= 253 ? domain : null;
};

const providerOf = (name: string | null | undefined) =>
  name && (MESSAGE_PROVIDERS as readonly string[]).includes(name)
    ? (name as (typeof MESSAGE_PROVIDERS)[number])
    : null;

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
  /** Provider health counts, recorded by the caller after the transaction (M3.5b). */
  health: HealthTick[] = [],
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
  // The org's own senders (M3.5b): verified sending domain, active 10DLC service, WhatsApp route.
  const senders = await orgSendersTx(tx);
  // U10: the org's From name and Reply-To on every email it sends.
  const identity = await emailIdentityTx(tx);
  // Policy gate v2 (M3.5a): quotas and caps loaded once for this org's batch.
  const gate = createGateState(orgId, org.timezone, now);
  const needEmails = due.filter((r) => r.channel === 'email' && !r.recipientEmail && r.recipientUserId);
  const memberIds = [...new Set(needEmails.map((r) => r.recipientUserId as string))];
  const emails =
    memberIds.length && deps.userEmails ? await deps.userEmails(memberIds) : new Map<string, string>();
  // Member notifications (no address of their own) render in the member's language, looked up at
  // send time so a change applies to messages already queued.
  // Every member row (email, push, and texts to members' own numbers, M3.2b) is looked up.
  const localeIds = [
    ...new Set(
      due.filter((r) => !r.recipientEmail && r.recipientUserId).map((r) => r.recipientUserId as string),
    ),
  ];
  const locales =
    localeIds.length && deps.userLocales
      ? await deps.userLocales(localeIds)
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

  const contents = new Map<string, Promise<StoredContent | null>>();
  const storedContentOf = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(null);
    let p = contents.get(id);
    if (!p) {
      p = storedContentTx(tx, id);
      contents.set(id, p);
    }
    return p;
  };

  const update = (row: Row, set: Partial<Row>) =>
    tx
      .update(messages)
      .set({ ...set, updatedAt: now })
      .where(eq(messages.id, row.id));
  // A message that can't reach the person on its channel for a reachability reason goes to the
  // category's next channel in this same transaction (M3.5b fallback chains).
  const fallBack = async (row: Row, reason: string) => {
    if (isFallbackReason(reason)) await fallbackTx(tx, orgId, row, reason, now);
  };
  const suppress = async (row: Row, reason: string) => {
    await update(row, { status: 'suppressed', reason });
    result.suppressed += 1;
    await fallBack(row, reason);
  };
  const fail = async (row: Row, reason: string, set: Partial<Row> = {}) => {
    await update(row, { status: 'failed', reason, attempts: row.attempts + 1, ...set });
    result.failed += 1;
    await fallBack(row, reason);
  };
  const apply = async (row: Row, verdict: Verdict) => {
    if (verdict.action === 'block') await suppress(row, verdict.reason);
    else {
      await update(row, { sendAfter: verdict.until, reason: verdict.reason });
      result.held += 1;
    }
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
      if (row.channel !== 'sms' && row.channel !== 'whatsapp') return null;
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
        row.channel === 'whatsapp' ? 'sms' : (row.channel as 'email' | 'sms' | 'push'),
      ))
    ) {
      await suppress(row, 'preference');
      continue;
    }
    // Push: the recipient's active devices (members by user, buyers by email) and, for quiet
    // hours, the timezone their most recent device reported.
    const devices = row.channel === 'push' ? await pushDevicesOf(tx, row) : [];
    const facts: GateFacts = {
      tx,
      orgId,
      row,
      def,
      now,
      phone: email ? null : address,
      orgTimeZone: org.timezone,
      ignoreQuietHours: Boolean(deps.ignoreQuietHours),
      state: gate,
    };
    const eligibility = await runPolicyPhase('eligibility', facts);
    if (eligibility) {
      await apply(row, eligibility);
      continue;
    }
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
    const timing = await runPolicyPhase('timing', facts);
    if (timing) {
      await apply(row, timing);
      continue;
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
      // Stored content (M3.6b campaigns): the campaign's rendered email, filled for this recipient.
      const contentId = typeof params._content === 'string' && params._content ? params._content : null;
      const stored = contentId ? await storedContentOf(contentId) : null;
      if (contentId && !stored) {
        await update(row, { status: 'failed', reason: 'no_content', attempts: row.attempts + 1 });
        result.failed += 1;
        continue;
      }
      const filled = stored
        ? renderStoredContent(stored, {
            name: row.recipientName,
            email,
            orgName: org.name,
            unsubscribeUrl: unsub?.page ?? null,
            origin: deps.appOrigin,
          })
        : null;
      const storedLang = stored ? emailLocale(stored.locale) : null;
      const rendered: RenderedMessage =
        filled && storedLang
          ? {
              subject: filled.subject,
              html: filled.html,
              text: filled.text,
              lang: storedLang,
              dir: RTL_LOCALES.has(storedLang) ? 'rtl' : 'ltr',
              preview: filled.preview,
            }
          : renderMessage({
              kind: row.kind as MessageKind,
              locale,
              params: consoleLink && !params.url ? { ...params, url: consoleLink } : params,
              // The brand kit logo (M1.4e) as an absolute URL on the app origin (email clients fetch it).
              org: {
                ...org,
                logoUrl: org.logoPath ? `${deps.appOrigin.replace(/\/$/, '')}${org.logoPath}` : null,
              },
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
      let provider: string | undefined;
      let segments: number | null = null;
      const textBody = () =>
        filled?.sms
          ? [
              `${org.name}: ${filled.sms}`,
              ...(optional ? [EMAIL_MESSAGES[rendered.lang].common.smsStop] : []),
            ].join('\n')
          : smsText(rendered, { orgName: org.name, category: def.category, body: params.body, link });
      if (row.channel === 'email') {
        if (!email) {
          await fail(row, 'no_address');
          continue;
        }
        const headers: Record<string, string> = { 'X-Yayatoh-Message': row.id };
        if (unsub) {
          // RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click` to this URL.
          headers['List-Unsubscribe'] = `<${unsub.oneClick}>`;
          headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
        }
        ({ providerMessageId, provider } = await deps.transports.email.send({
          from: { name: identity.fromName ?? org.name, address: PLATFORM_SENDER },
          ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers,
          idempotencyKey: row.id,
          sender: senders.email,
          orgId,
        }));
        provider ??= deps.transports.email.name;
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
          await fail(row, 'provider_error', { lastError: 'push: refused by the push service' });
          continue;
        }
        providerMessageId = outcome.providerMessageId;
        provider = push.name;
      } else if (row.channel === 'whatsapp') {
        const wa = deps.transports.whatsapp;
        const phone = typeof params._phone === 'string' ? params._phone : null;
        if (!wa) throw new Error('no WhatsApp adapter configured');
        if (!phone) {
          await fail(row, 'no_address');
          continue;
        }
        ({ providerMessageId, provider } = await wa.send({
          to: phone,
          body: textBody(),
          category: whatsappCategoryOf(row.kind),
          idempotencyKey: row.id,
          locale,
          orgName: org.name,
          sender: senders.whatsapp,
        }));
        provider ??= wa.name;
      } else {
        const sms = deps.transports.sms;
        const phone = typeof params._phone === 'string' ? params._phone : null;
        if (!sms) throw new Error('no SMS adapter configured');
        if (!phone) {
          await fail(row, 'no_address');
          continue;
        }
        const body = textBody();
        segments = smsSegments(body).segments;
        ({ providerMessageId, provider } = await sms.send({
          to: phone,
          body,
          idempotencyKey: row.id,
          sender: senders.sms,
        }));
        provider ??= sms.name;
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
        segments,
        provider: providerOf(provider),
        senderDomain:
          row.channel === 'email' ? senderDomainOf(senders.email?.address ?? PLATFORM_SENDER) : null,
      });
      if (provider && row.channel !== 'push') health.push({ provider, kind: 'send' });
      // Usage metering (M3.5a): SMS by segment, everything else by message.
      await gate.meter(tx, row.channel as QuotaChannel, segments ?? 1);
      result.sent += 1;
    } catch (err) {
      const channelProvider =
        errorProvider(err) ??
        (row.channel === 'email'
          ? deps.transports.email.name
          : row.channel === 'sms'
            ? deps.transports.sms?.name
            : row.channel === 'whatsapp'
              ? deps.transports.whatsapp?.name
              : deps.transports.push?.name);
      // A provider's permanent refusal (M3.5b): final at once; reachability refusals fall back.
      if (isProviderRejection(err)) {
        if (channelProvider)
          health.push({
            provider: channelProvider,
            kind: 'send_error',
            error: `${err.code} ${err.providerCode ?? ''}`.trim(),
          });
        await fail(row, REJECTION_REASONS[err.code], { lastError: err.message.slice(0, 500) });
        continue;
      }
      if (channelProvider) health.push({ provider: channelProvider, kind: 'send_error', error: 'error' });
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await update(row, {
        attempts,
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ...(final
          ? { status: 'failed', reason: 'provider_error' }
          : { sendAfter: new Date(now.getTime() + 2 ** attempts * 60_000), reason: 'retrying' }),
      });
      if (final) {
        result.failed += 1;
        await fallBack(row, 'provider_error');
      } else result.held += 1;
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
    const delivery = {
      orgId,
      messageId: row.id,
      platform: d.platform,
      status,
      httpStatus,
      providerMessageId,
      sentAt: status === 'sent' ? now : null,
    };
    // The device list was read before the send, and its owner may remove the device meanwhile
    // (another tab, account erasure). The attempt is still logged, with the reference cleared as
    // ON DELETE SET NULL would have done: in a savepoint, so the FK violation cannot abort the
    // tenant transaction and the rest of the batch (other devices, other messages) goes on.
    try {
      await tx.transaction((sp) =>
        sp
          .insert(pushDeliveries)
          .values({ ...delivery, pushTokenId: d.id })
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
          }),
      );
    } catch (err) {
      if (!isForeignKeyViolation(err, 'push_deliveries_token_fk')) throw err;
      await tx
        .insert(pushDeliveries)
        .values({ ...delivery, pushTokenId: null, attempts: (prior?.attempts ?? 0) + 1 });
    }
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

/**
 * One org's dispatch in its own tenant transaction (worker tick, dev drain); provider health is
 * counted after it commits (M3.5b).
 */
export async function dispatchDue(orgId: string, deps: DispatchDeps, limit = 50): Promise<DispatchResult> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'notifications.dispatcher' } });
  const health: HealthTick[] = [];
  const result = await withTenant(ctx, (tx) => dispatchDueTx(tx, orgId, deps, limit, health));
  await recordProviderHealth(health);
  return result;
}
