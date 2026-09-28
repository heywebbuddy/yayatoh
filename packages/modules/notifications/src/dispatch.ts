import { consentRegivenSinceTx, normalizeEmail } from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { erasedAddressesTx, normalizeAddress, signLinkToken } from '@yayatoh/platform';
import { activeSuspensionsTx, organizationBrandTx } from '@yayatoh/tenancy';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { erasedAddressAllows, erasedMailClass, suppressedReason } from './delivery-rules.ts';
import { kindOf, type MessageKind } from './kinds.ts';
import { decryptParams } from './notifier.ts';
import { preferenceEnabledTx } from './preferences.ts';
import { isValidTimeZone, quietHoursRelease } from './quiet-hours.ts';
import { addressSuppressions, messages, pushTokens, suppressions, templateOverrides } from './schema.ts';
import { emailLocale, renderMessage } from './templates/render.ts';
import { PLATFORM_SENDER, type Transports } from './transports.ts';

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
    .filter((r) => r.channel === 'email')
    .map((r) => r.recipientEmail ?? emails.get(r.recipientUserId ?? '') ?? null)
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
    // Erased addresses (M1.14e): only order mail, account mail after a new sign-up, and org mail
    // after a new consent in this org.
    const erasedEntry = email ? erased.get(normalizeAddress(email)) : undefined;
    if (email && erasedEntry) {
      const mailClass = erasedMailClass(row.kind, def);
      const allowed = erasedAddressAllows({
        mailClass,
        accountLiftedAt: erasedEntry.accountLiftedAt,
        consentRegiven:
          mailClass === 'org' &&
          (await consentRegivenSinceTx(tx, normalizeEmail(email), 'email', erasedEntry.erasedAt)),
      });
      if (!allowed) {
        await suppress(row, 'erased');
        continue;
      }
    }
    if (optional && email) {
      const [s] = await tx
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(
          and(eq(suppressions.emailNorm, normalizeEmail(email)), eq(suppressions.category, def.category)),
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
    if (!def.urgent && !deps.ignoreQuietHours) {
      const tz = isValidTimeZone(row.timeZone) ? row.timeZone : org.timezone;
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
      const rendered = renderMessage({
        kind: row.kind as MessageKind,
        locale,
        params,
        // The brand kit logo (M1.4e) as an absolute URL on the app origin (email clients fetch it).
        org: { ...org, logoUrl: org.logoPath ? `${deps.appOrigin.replace(/\/$/, '')}${org.logoPath}` : null },
        recipientName: row.recipientName,
        unsubscribeUrl: unsub?.page ?? null,
        override: override ?? null,
      });
      const link =
        typeof params.url === 'string' && params.url
          ? params.url
          : href
            ? `${deps.appOrigin}/o/${org.slug}${href}`
            : null;
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
        const tokens = await tx
          .select()
          .from(pushTokens)
          .where(and(eq(pushTokens.userId, row.recipientUserId ?? ''), isNull(pushTokens.disabledAt)));
        if (!push) throw new Error('no push adapter configured');
        if (tokens.length === 0) {
          await suppress(row, 'no_device');
          continue;
        }
        const ids: string[] = [];
        for (const t of tokens) {
          const r = await push.send({
            platform: t.platform as 'fcm' | 'apns' | 'webpush',
            token: t.token,
            title: rendered.subject,
            body: rendered.preview,
            url: link,
            idempotencyKey: `${row.id}:${t.id}`,
          });
          if ('error' in r)
            await tx
              .update(pushTokens)
              .set({ disabledAt: now, updatedAt: now })
              .where(eq(pushTokens.id, t.id));
          else ids.push(r.providerMessageId);
        }
        if (ids.length === 0) {
          await suppress(row, 'no_device');
          continue;
        }
        providerMessageId = ids.join(',');
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

/** One org's dispatch in its own tenant transaction (worker tick, dev drain). */
export function dispatchDue(orgId: string, deps: DispatchDeps, limit = 50): Promise<DispatchResult> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'notifications.dispatcher' } });
  return withTenant(ctx, (tx) => dispatchDueTx(tx, orgId, deps, limit));
}
