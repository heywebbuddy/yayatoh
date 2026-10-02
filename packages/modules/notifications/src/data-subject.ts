import type { TenantTx } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  REDACT,
  refsOf,
  type SubjectErasure,
  subjectNeedles,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, not, or, type SQL, sql } from 'drizzle-orm';
import { eraseSubjectPushDevicesTx } from './account-data.ts';
import { encryptParams } from './notifier.ts';
import { recipientKey } from './policy/gate.ts';
import {
  addressSuppressions,
  emailPreviews,
  inboxItems,
  messageEvents,
  messages,
  pushTokens,
  suppressions,
} from './schema.ts';

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const mentions = (col: SQL, needles: readonly string[]) =>
  or(...needles.map((n) => sql`${col} ilike ${`%${likeEscape(n)}%`} escape '\\'`)) as SQL;

/**
 * Messages addressed to the person: by address, their crm contacts, the keyed caps hash of their
 * address or numbers (texts keep the number only inside the sealed params), or a dedupe key built
 * from their address (reminders, announcements).
 */
function toSubject(s: DataSubject): SQL {
  const contacts = refsOf(s, 'contact');
  const keys = [
    recipientKey('email', s.email),
    ...refsOf(s, 'phone').flatMap((p) => [recipientKey('sms', p), recipientKey('whatsapp', p)]),
  ].filter((k): k is string => Boolean(k));
  return or(
    sql`lower(btrim(${messages.recipientEmail})) = ${s.email}`,
    contacts.length ? inArray(messages.contactId, contacts) : undefined,
    keys.length ? inArray(messages.recipientKey, keys) : undefined,
    sql`position(${s.email} in lower(${messages.dedupeKey})) > 0`,
  ) as SQL;
}

/** The person's org-level suppressions: email unsubscribes and bounce/complaint/STOP entries. */
function addressRowsOf(s: DataSubject): SQL {
  const phones = refsOf(s, 'phone');
  return or(
    and(eq(addressSuppressions.channel, 'email'), eq(addressSuppressions.addressNorm, s.email)),
    phones.length
      ? and(
          inArray(addressSuppressions.channel, ['sms', 'whatsapp']),
          inArray(addressSuppressions.addressNorm, phones),
        )
      : undefined,
  ) as SQL;
}

/**
 * notifications' part of a data-subject request (M6.1c).
 * - Messages to the person stay in the log (delivery evidence, quotas and metering) but lose the
 *   address, name, subject, sealed params (replaced by an empty sealed object), provider error,
 *   caps hash and any dedupe key built from the address; queued ones are cancelled. Staff
 *   notifications about the person's orders lose their subject and params the same way. Provider
 *   delivery reports on their messages lose the diagnostic text (it can quote the address).
 * - Org suppressions for the address (unsubscribes, bounces, complaints) and for their numbers
 *   (STOP) are deleted: an erased address is on the platform-wide erased list
 *   (`platform.erased_addresses`), which the dispatcher and every import consult, so it is never
 *   mailed again; the erased person's numbers are gone from every record, and texts need a consent
 *   in the crm ledger, so a number re-entered later needs fresh consent anyway.
 * - Browser push devices registered under the address are deleted (their delivery log keeps rows
 *   with the device cleared). Staff inbox items about their orders or naming them, and stored
 *   email previews that mention them (staff test renders, ten-minute rows), are deleted.
 */
export const notificationsDataSubjects = defineDataSubjectContributor({
  module: 'notifications',
  tables: {
    'notifications.messages': REDACT,
    'notifications.message_events': REDACT,
    'notifications.suppressions': DELETE,
    'notifications.address_suppressions': DELETE,
    'notifications.push_tokens': DELETE,
    'notifications.inbox_items': DELETE,
    'notifications.email_previews': DELETE,
  },
  async export(tx: TenantTx, s) {
    const sent = await tx.select().from(messages).where(toSubject(s)).orderBy(asc(messages.createdAt));
    const unsubscribed = await tx
      .select({
        category: suppressions.category,
        source: suppressions.source,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      .where(eq(suppressions.emailNorm, s.email));
    const blocked = await tx
      .select({
        channel: addressSuppressions.channel,
        address: addressSuppressions.addressNorm,
        reason: addressSuppressions.reason,
        createdAt: addressSuppressions.createdAt,
      })
      .from(addressSuppressions)
      .where(addressRowsOf(s));
    const devices = await tx
      .select({
        platform: pushTokens.platform,
        label: pushTokens.label,
        since: pushTokens.createdAt,
        lastSeenAt: pushTokens.lastSeenAt,
        disabledAt: pushTokens.disabledAt,
      })
      .from(pushTokens)
      .where(eq(pushTokens.emailNorm, s.email));
    return {
      sections: {
        messages: sent.map((m) => ({
          kind: m.kind,
          category: m.category,
          channel: m.channel,
          status: m.status,
          recipientEmail: m.recipientEmail,
          recipientName: m.recipientName,
          subject: m.subject,
          eventId: m.eventId,
          orderId: m.orderId,
          delivery: m.delivery,
          createdAt: m.createdAt,
          sentAt: m.sentAt,
        })),
        unsubscribes: unsubscribed,
        suppressions: blocked,
        pushDevices: devices,
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const blank = await encryptParams(requireOrg(ctx), {});
    const queuedThen = <T>(then: T, otherwise: SQL) =>
      sql`case when ${messages.status} = 'queued' then ${then} else ${otherwise} end`;
    const mine = await tx
      .update(messages)
      .set({
        recipientEmail: sql`case when ${messages.recipientEmail} is null then null else ${ERASED_EMAIL} end`,
        recipientName: null,
        subject: null,
        paramsCiphertext: blank,
        lastError: null,
        recipientKey: null,
        dedupeKey: sql`case when position(${s.email} in lower(${messages.dedupeKey})) > 0 then 'erased:' || ${messages.id}::text else ${messages.dedupeKey} end`,
        status: queuedThen('canceled', sql`${messages.status}`),
        reason: queuedThen('erased', sql`${messages.reason}`),
        updatedAt: now,
      })
      .where(toSubject(s))
      .returning({ id: messages.id });
    const mineIds = mine.map((m) => m.id);
    const orders = refsOf(s, 'order');
    const staff = orders.length
      ? await tx
          .update(messages)
          .set({
            subject: null,
            paramsCiphertext: blank,
            status: queuedThen('canceled', sql`${messages.status}`),
            reason: queuedThen('erased', sql`${messages.reason}`),
            updatedAt: now,
          })
          .where(
            and(
              inArray(messages.orderId, orders),
              isNotNull(messages.recipientUserId),
              mineIds.length ? not(inArray(messages.id, mineIds)) : undefined,
            ),
          )
          .returning({ id: messages.id })
      : [];
    // Provider events are append-only for the app: their diagnostic text is cleared through the
    // SECURITY DEFINER `notifications.redact_message_event_details` (this org only).
    const reports = mineIds.length
      ? await tx.execute<{ n: number }>(
          sql`select notifications.redact_message_event_details(array[${sql.join(
            mineIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[]) as n`,
        )
      : [];
    const unsubscribes = await tx
      .delete(suppressions)
      .where(eq(suppressions.emailNorm, s.email))
      .returning({ id: suppressions.id });
    const blocked = await tx
      .delete(addressSuppressions)
      .where(addressRowsOf(s))
      .returning({ id: addressSuppressions.id });
    const devices = await eraseSubjectPushDevicesTx(tx, s.email);
    const needles = subjectNeedles(s);
    const inbox = await tx
      .delete(inboxItems)
      .where(
        or(
          orders.length ? inArray(inboxItems.orderId, orders) : undefined,
          mentions(sql`${inboxItems.params}::text`, needles),
        ) as SQL,
      )
      .returning({ id: inboxItems.id });
    const previews = await tx
      .delete(emailPreviews)
      .where(mentions(sql`${emailPreviews.html}`, needles))
      .returning({ id: emailPreviews.id });
    return {
      erased: {
        'notifications.messages': mine.length + staff.length,
        'notifications.message_events': Number(reports[0]?.n ?? 0),
        'notifications.suppressions': unsubscribes.length,
        'notifications.address_suppressions': blocked.length,
        'notifications.push_tokens': devices,
        'notifications.inbox_items': inbox.length,
        'notifications.email_previews': previews.length,
      },
    };
  },
});
