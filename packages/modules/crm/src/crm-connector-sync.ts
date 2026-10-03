import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { and, eq, sql } from 'drizzle-orm';
import { currentConsentTx, recordConsentTx } from './contacts.ts';
import { contacts } from './schema.ts';
import { writeSyncedContactTx } from './sync.ts';

/**
 * Contacts, consent and event participation for CRM connectors (M6.5b, Salesforce). The
 * integrations module reads who may be pushed (the latest email marketing consent is `granted`;
 * no row means no consent) and writes people a CRM sends. A CRM can withdraw consent here (its
 * "email opt out"), never grant it. Merged-away contacts never sync.
 */

export interface CrmPersonRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly company: string | null;
  /** When the person or their consent last changed (the keyset position's time). */
  readonly changedAt: Date;
  /** The keyset position after this row (`<time with microseconds>|<id>`). */
  readonly cursor: string;
}

type PersonRaw = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  changed_at: Date | string;
  pos: string;
};

const person = (r: PersonRaw): CrmPersonRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  company: r.company,
  changedAt: new Date(r.changed_at),
  cursor: `${r.pos}|${r.id}`,
});

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f-]{36})$/;

/**
 * Contacts whose latest email marketing consent is `granted`, changed (the contact, or a newer
 * consent row) after `cursor`, oldest first. A contact who grants consent again moves past the
 * cursor, so a CRM sync picks them up; one who withdraws simply stops appearing.
 */
export async function consentedContactsChangedTx(
  tx: TenantTx,
  cursor: string | null,
  limit: number,
): Promise<CrmPersonRow[]> {
  const m = cursor ? CURSOR.exec(cursor) : null;
  const after = m ? sql`where (changed_at, id) > (${m[1]}::timestamptz, ${m[2]}::uuid)` : sql``;
  const rows = await tx.execute<PersonRaw>(sql`
    with consented as (
      select c.id, c.email, c.name, c.company, greatest(c.updated_at, lc.captured_at) as changed_at
      from crm.contacts c
      join lateral (
        select k.status, k.captured_at from crm.consents k
        where k.org_id = c.org_id and k.contact_id = c.id and k.channel = 'email' and k.purpose = 'marketing'
        order by k.captured_at desc, k.id desc
        limit 1
      ) lc on lc.status = 'granted'
      where c.merged_into is null
    )
    select id, email, name, company, changed_at,
      to_char(changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as pos
    from consented ${after}
    order by changed_at, id
    limit ${Math.max(1, Math.min(limit, 1000))}`);
  return rows.map(person);
}

export interface CrmConsentRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly company: string | null;
  readonly updatedAt: Date;
  /** The latest email marketing consent (null: none recorded, which means no consent). */
  readonly consent: 'granted' | 'withdrawn' | 'unknown_legacy' | null;
}

/** These contacts (merged-away ones left out) with their current email marketing consent. */
export async function contactsWithConsentTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, CrmConsentRow>> {
  const out = new Map<string, CrmConsentRow>();
  const ids = [...new Set(contactIds)];
  for (let i = 0; i < ids.length; i += 1_000) {
    const part = ids.slice(i, i + 1_000);
    const rows = await tx.execute<{
      id: string;
      email: string;
      name: string | null;
      company: string | null;
      updated_at: Date | string;
      status: string | null;
    }>(sql`
      select c.id, c.email, c.name, c.company, c.updated_at, lc.status
      from crm.contacts c
      left join lateral (
        select k.status from crm.consents k
        where k.org_id = c.org_id and k.contact_id = c.id and k.channel = 'email' and k.purpose = 'marketing'
        order by k.captured_at desc, k.id desc
        limit 1
      ) lc on true
      where c.id = any(${sql`ARRAY[${sql.join(
        part.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`}) and c.merged_into is null`);
    for (const r of rows)
      out.set(r.id, {
        id: r.id,
        email: r.email,
        name: r.name,
        company: r.company,
        updatedAt: new Date(r.updated_at),
        consent: (r.status as CrmConsentRow['consent']) ?? null,
      });
  }
  return out;
}

/**
 * Write a person a CRM sent (the email is the key, as `writeSyncedContactTx`), with their company
 * when the CRM has one (an empty one keeps ours). Returns the contact's id.
 */
export async function writeCrmPersonTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    readonly contactId: string | null;
    readonly email: string;
    readonly name: string | null;
    readonly company: string | null;
  },
): Promise<string> {
  const id = await writeSyncedContactTx(tx, ctx, input);
  const company = input.company?.trim().slice(0, 200) || null;
  if (company)
    await tx
      .update(contacts)
      .set({ company, updatedAt: ctx.now })
      .where(and(eq(contacts.id, id), sql`${contacts.company} is distinct from ${company}`));
  return id;
}

/**
 * A CRM says the person opted out of email: withdraw their email marketing consent here (only
 * when it is currently granted, so a repeat writes nothing). Returns whether it withdrew.
 */
export async function withdrawEmailMarketingTx(
  tx: TenantTx,
  ctx: Ctx,
  contactId: string,
  evidence: string,
): Promise<boolean> {
  if ((await currentConsentTx(tx, contactId, 'email', 'marketing')) !== 'granted') return false;
  await recordConsentTx(tx, ctx, {
    contactId,
    channel: 'email',
    purpose: 'marketing',
    status: 'withdrawn',
    evidence: evidence.slice(0, 200),
  });
  return true;
}

export interface CrmParticipationRow {
  readonly id: string;
  readonly contactId: string;
  readonly eventId: string;
  readonly registered: boolean;
  readonly checkedIn: boolean;
}

/**
 * Event participation rows of people on an event's list or checked in there (campaign members),
 * in id order after `afterId`, or these ids. Merged-away contacts are left out.
 */
export async function crmParticipationRowsTx(
  tx: TenantTx,
  opts: { readonly afterId?: string | null; readonly ids?: readonly string[]; readonly limit: number },
): Promise<CrmParticipationRow[]> {
  const by = opts.ids
    ? opts.ids.length
      ? sql`and p.id = any(${sql`ARRAY[${sql.join(
          opts.ids.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`})`
      : sql`and false`
    : opts.afterId
      ? sql`and p.id > ${opts.afterId}::uuid`
      : sql``;
  const rows = await tx.execute<{
    id: string;
    contact_id: string;
    event_id: string;
    registered: boolean;
    checked_in: boolean;
  }>(sql`
    select p.id, p.contact_id, p.event_id, p.registered, p.checked_in
    from crm.event_participation p
    join crm.contacts c on c.org_id = p.org_id and c.id = p.contact_id and c.merged_into is null
    where (p.registered or p.checked_in) ${by}
    order by p.id
    limit ${Math.max(1, Math.min(opts.limit, 1000))}`);
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    eventId: r.event_id,
    registered: r.registered,
    checkedIn: r.checked_in,
  }));
}
