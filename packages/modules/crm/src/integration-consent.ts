import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { and, eq, sql } from 'drizzle-orm';
import { currentConsentTx, recordConsentTx } from './contacts.ts';
import { contacts } from './schema.ts';

/**
 * Contacts and consent for marketing-tool syncs (M6.4d: Mailchimp, Klaviyo, HubSpot). The
 * integrations module reads who may be pushed and writes what a provider says back (an
 * unsubscribe withdraws email marketing consent here, with the provider as evidence). Consent is
 * never granted from a provider: no row means no consent.
 */

export interface ContactConsentRow {
  readonly contactId: string;
  readonly email: string;
  readonly name: string | null;
  readonly company: string | null;
  readonly phone: string | null;
  readonly updatedAt: Date;
  /** The latest email marketing consent row's status (null: none recorded). */
  readonly consent: 'granted' | 'withdrawn' | 'unknown_legacy' | null;
  readonly consentAt: Date | null;
}

type Raw = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  phone_e164: string | null;
  updated_at: Date | string;
  status: string | null;
  captured_at: Date | string | null;
};

const uuidArray = (ids: readonly string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

/** These contacts (merged-away ones left out) with their current email marketing consent. */
export async function contactsConsentTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<ContactConsentRow[]> {
  const out: ContactConsentRow[] = [];
  for (let i = 0; i < contactIds.length; i += 1_000) {
    const part = contactIds.slice(i, i + 1_000);
    if (part.length === 0) continue;
    const rows = await tx.execute<Raw>(sql`
      select c.id, c.email, c.name, c.company, c.phone_e164, c.updated_at, lc.status, lc.captured_at
      from crm.contacts c
      left join lateral (
        select k.status, k.captured_at from crm.consents k
        where k.org_id = c.org_id and k.contact_id = c.id and k.channel = 'email' and k.purpose = 'marketing'
        order by k.captured_at desc, k.id desc
        limit 1
      ) lc on true
      where c.id = any(${uuidArray(part)}) and c.merged_into is null
      order by c.id`);
    for (const r of rows)
      out.push({
        contactId: r.id,
        email: r.email,
        name: r.name,
        company: r.company,
        phone: r.phone_e164,
        updatedAt: new Date(r.updated_at),
        consent: (r.status as ContactConsentRow['consent']) ?? null,
        consentAt: r.captured_at === null ? null : new Date(r.captured_at),
      });
  }
  return out;
}

/** Contact ids after `afterId` in id order (merged-away ones left out), one page. */
export async function contactIdsAfterTx(
  tx: TenantTx,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from crm.contacts
    where merged_into is null ${afterId ? sql`and id > ${afterId}::uuid` : sql``}
    order by id
    limit ${Math.max(1, Math.min(limit, 1_000))}`);
  return rows.map((r) => r.id);
}

/**
 * Withdraw a contact's email marketing consent because a connected provider says the person
 * unsubscribed there. Writes a ledger row only when the current status is not already withdrawn
 * (a replayed sync writes nothing). Returns whether a row was written.
 */
export async function withdrawEmailMarketingTx(
  tx: TenantTx,
  ctx: Ctx,
  contactId: string,
  evidence: string,
): Promise<boolean> {
  if ((await currentConsentTx(tx, contactId, 'email', 'marketing')) === 'withdrawn') return false;
  await recordConsentTx(tx, ctx, {
    contactId,
    channel: 'email',
    purpose: 'marketing',
    status: 'withdrawn',
    evidence: evidence.slice(0, 200),
  });
  return true;
}

/** Set a synced contact's company when the provider sent one that differs (empty keeps ours). */
export async function setSyncedContactCompanyTx(
  tx: TenantTx,
  ctx: Ctx,
  contactId: string,
  company: string | null,
): Promise<void> {
  const value = company?.trim().slice(0, 200) ?? '';
  if (!value) return;
  await tx
    .update(contacts)
    .set({ company: value, updatedAt: ctx.now })
    .where(and(eq(contacts.id, contactId), sql`${contacts.company} is distinct from ${value}`));
}

export interface ParticipationSyncRow {
  readonly id: string;
  readonly contactId: string;
  readonly eventId: string;
  readonly registered: boolean;
  readonly checkedIn: boolean;
  readonly updatedAt: Date;
}

type RawPart = {
  id: string;
  contact_id: string;
  event_id: string;
  registered: boolean;
  checked_in: boolean;
  updated_at: Date | string;
};
const part = (r: RawPart): ParticipationSyncRow => ({
  id: r.id,
  contactId: r.contact_id,
  eventId: r.event_id,
  registered: r.registered,
  checkedIn: r.checked_in,
  updatedAt: new Date(r.updated_at),
});

/** Participation rows (contact × event) after `afterId` in id order for these events, one page. */
export async function participationsAfterTx(
  tx: TenantTx,
  eventIds: readonly string[],
  afterId: string | null,
  limit: number,
): Promise<ParticipationSyncRow[]> {
  if (eventIds.length === 0) return [];
  const rows = await tx.execute<RawPart>(sql`
    select id, contact_id, event_id, registered, checked_in, updated_at from crm.event_participation
    where event_id = any(${uuidArray(eventIds)}) ${afterId ? sql`and id > ${afterId}::uuid` : sql``}
    order by id
    limit ${Math.max(1, Math.min(limit, 1_000))}`);
  return rows.map(part);
}

/** One participation row (null when gone). */
export async function participationByIdTx(tx: TenantTx, id: string): Promise<ParticipationSyncRow | null> {
  const [r] = await tx.execute<RawPart>(sql`
    select id, contact_id, event_id, registered, checked_in, updated_at from crm.event_participation
    where id = ${id}::uuid`);
  return r ? part(r) : null;
}
