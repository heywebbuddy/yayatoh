import { contactIdByEmailTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { keyVault, type NotificationChannel, type Notifier } from '@yayatoh/platform';
import { memberUserIdsTx } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { kindOf } from './kinds.ts';
import { recipientKey } from './policy/gate.ts';
import { preferenceEnabledTx } from './preferences.ts';
import { inboxItems, messages } from './schema.ts';

const currentOrg = async (tx: TenantTx): Promise<string> => {
  const [row] = await tx.execute<{ org: string }>(
    sql`select nullif(current_setting('app.org_id', true), '') as org`,
  );
  if (!row?.org) throw new Error('notifications: no tenant in this transaction');
  return row.org;
};

export async function encryptParams(orgId: string, params: Readonly<Record<string, string | number>>) {
  return keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(params)));
}

export async function decryptParams(
  orgId: string,
  ciphertext: string,
): Promise<Record<string, string | number>> {
  return JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext)));
}

/** Put an item in a member's inbox, unless they switched in-app off for its category. */
export async function addInboxItemTx(
  tx: TenantTx,
  item: {
    orgId: string;
    userId: string;
    kind: string;
    params: Readonly<Record<string, string | number>>;
    dedupeKey: string;
    href?: string | null;
    orderId?: string | null;
    eventId?: string | null;
  },
): Promise<number> {
  const def = kindOf(item.kind);
  if (!(await preferenceEnabledTx(tx, item.userId, def.category, 'in_app'))) return 0;
  const rows = await tx
    .insert(inboxItems)
    .values({
      orgId: item.orgId,
      userId: item.userId,
      kind: item.kind,
      params: item.params,
      dedupeKey: item.dedupeKey,
      href: item.href ?? null,
      orderId: item.orderId ?? null,
      eventId: item.eventId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: inboxItems.id });
  return rows.length;
}

/**
 * The notifications module's implementation of the platform `Notifier` port. One row per
 * channel under `(org, channel, dedupe_key)`: a replayed or duplicated event inserts nothing.
 * The dispatcher sends later (policy gate, render, adapter), so this never talks to a provider.
 */
export function createNotifier(): Notifier {
  return {
    async enqueue(tx, intent) {
      const def = kindOf(intent.kind);
      const orgId = await currentOrg(tx);
      const channels = (intent.channels ?? def.channels).filter(
        (c): c is Exclude<NotificationChannel, 'in_app'> => {
          if (c === 'email') return Boolean(intent.to.email || intent.to.userId);
          if (c === 'push') return Boolean(intent.to.userId);
          if (c === 'sms' || c === 'whatsapp') return Boolean(intent.to.phone);
          return false;
        },
      );
      let queued = 0;
      if ((intent.channels ?? def.channels).includes('in_app') && intent.to.userId)
        queued += await addInboxItemTx(tx, {
          orgId,
          userId: intent.to.userId,
          kind: intent.kind,
          params: intent.params,
          dedupeKey: intent.dedupeKey,
          orderId: intent.orderId,
          eventId: intent.eventId,
        });
      if (channels.length === 0) return { queued };
      const paramsCiphertext = await encryptParams(orgId, {
        ...intent.params,
        ...(intent.to.phone ? { _phone: intent.to.phone } : {}),
      });
      // M3.5a: the contact (consent ledger), the address's region (state rules) and the caps key.
      const email = intent.to.email?.trim() || null;
      const contactId = intent.to.contactId ?? (email ? await contactIdByEmailTx(tx, email) : null);
      const region =
        intent.to.region && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(intent.to.region) ? intent.to.region : null;
      const keyOf = (channel: string) =>
        channel === 'email'
          ? recipientKey('email', email ?? (intent.to.userId ? `user:${intent.to.userId}` : null))
          : channel === 'push'
            ? recipientKey('push', intent.to.userId)
            : recipientKey(channel, intent.to.phone);
      for (const channel of channels) {
        const rows = await tx
          .insert(messages)
          .values({
            orgId,
            kind: intent.kind,
            category: def.category,
            channel,
            dedupeKey: intent.dedupeKey,
            recipientEmail: channel === 'email' ? (intent.to.email?.trim() ?? null) : null,
            recipientUserId: intent.to.userId ?? null,
            recipientName: intent.to.name ?? null,
            locale: intent.to.locale ?? 'en',
            timeZone: intent.to.timeZone ?? null,
            orderId: intent.orderId ?? null,
            eventId: intent.eventId ?? null,
            occurrenceId: intent.occurrenceId ?? null,
            contactId,
            recipientRegion: region,
            recipientKey: keyOf(channel),
            paramsCiphertext,
            ...(intent.sendAfter ? { sendAfter: intent.sendAfter } : {}),
          })
          .onConflictDoNothing()
          .returning({ id: messages.id });
        queued += rows.length;
      }
      return { queued };
    },

    async notifyMembers(tx, intent) {
      const def = kindOf(intent.kind);
      if (!def.audience) throw new Error(`${intent.kind} is not a member notification`);
      const orgId = await currentOrg(tx);
      let queued = 0;
      for (const m of await memberUserIdsTx(tx, def.audience)) {
        const dedupeKey = `${intent.dedupeKey}:${m.userId}`;
        queued += await addInboxItemTx(tx, {
          orgId,
          userId: m.userId,
          kind: intent.kind,
          params: intent.params,
          dedupeKey,
          href: intent.href,
          orderId: intent.orderId,
          eventId: intent.eventId,
        });
        const channels = def.channels.filter((c) => c !== 'in_app');
        if (channels.length === 0) continue;
        const paramsCiphertext = await encryptParams(orgId, { ...intent.params, _href: intent.href ?? '' });
        for (const channel of channels) {
          // Skip rows the member switched off; the dispatcher checks again at send time.
          if (
            !(await preferenceEnabledTx(tx, m.userId, def.category, channel === 'whatsapp' ? 'sms' : channel))
          )
            continue;
          const rows = await tx
            .insert(messages)
            .values({
              orgId,
              kind: intent.kind,
              category: def.category,
              channel,
              dedupeKey,
              recipientUserId: m.userId,
              orderId: intent.orderId ?? null,
              eventId: intent.eventId ?? null,
              paramsCiphertext,
            })
            .onConflictDoNothing()
            .returning({ id: messages.id });
          queued += rows.length;
        }
      }
      return { queued };
    },
  };
}
