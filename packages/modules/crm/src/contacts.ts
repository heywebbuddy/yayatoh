import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { refreshContactProfilesTx } from './projection.ts';
import {
  type CONSENT_CHANNELS,
  type CONSENT_PURPOSES,
  type CONSENT_STATUSES,
  type CONTACT_SOURCES,
  consents,
  contacts,
} from './schema.ts';

/** The org-unique key for a contact: trimmed, lower-cased email. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface UpsertContact {
  readonly email: string;
  readonly name?: string | null;
  readonly source: (typeof CONTACT_SOURCES)[number];
}

/**
 * The batch form of upsertContactTx (imports): one statement for many emails. Returns the
 * contact id per normalized email. Duplicate emails in the input resolve to one contact.
 */
export async function upsertContactsTx(
  tx: TenantTx,
  ctx: Ctx,
  input: readonly UpsertContact[],
): Promise<Map<string, string>> {
  const orgId = requireOrg(ctx);
  const byNorm = new Map<string, UpsertContact>();
  for (const c of input) if (!byNorm.has(normalizeEmail(c.email))) byNorm.set(normalizeEmail(c.email), c);
  if (byNorm.size === 0) return new Map();
  const rows = await tx
    .insert(contacts)
    .values(
      [...byNorm].map(([emailNorm, c]) => ({
        orgId,
        email: c.email.trim(),
        emailNorm,
        name: c.name ?? null,
        source: c.source,
      })),
    )
    .onConflictDoUpdate({
      target: [contacts.orgId, contacts.emailNorm],
      set: { name: sql`coalesce(${contacts.name}, excluded.name)`, updatedAt: ctx.now },
    })
    .returning({ id: contacts.id, emailNorm: contacts.emailNorm });
  return new Map(rows.map((r) => [r.emailNorm, r.id]));
}

/**
 * Find or create the org's contact for an email, inside the caller's transaction. An existing
 * contact keeps its name unless it had none.
 */
export async function upsertContactTx(tx: TenantTx, ctx: Ctx, input: UpsertContact): Promise<{ id: string }> {
  const orgId = requireOrg(ctx);
  const emailNorm = normalizeEmail(input.email);
  const [row] = await tx
    .insert(contacts)
    .values({ orgId, email: input.email.trim(), emailNorm, name: input.name ?? null, source: input.source })
    .onConflictDoUpdate({
      target: [contacts.orgId, contacts.emailNorm],
      set: { name: sql`coalesce(${contacts.name}, excluded.name)`, updatedAt: ctx.now },
    })
    .returning({ id: contacts.id });
  if (!row) throw new DomainError('internal');
  return row;
}

export interface ConsentInput {
  readonly contactId: string;
  readonly channel: (typeof CONSENT_CHANNELS)[number];
  readonly purpose: (typeof CONSENT_PURPOSES)[number];
  readonly status: (typeof CONSENT_STATUSES)[number];
  readonly evidence: string;
}

export async function recordConsentTx(tx: TenantTx, ctx: Ctx, input: ConsentInput): Promise<void> {
  await tx.insert(consents).values({ orgId: requireOrg(ctx), ...input, capturedAt: ctx.now });
  // The profile's consent summary (M3.6) moves in the same transaction as the ledger.
  await refreshContactProfilesTx(tx, ctx, [input.contactId]);
}

/** The current consent status, or null when none was ever recorded (which means no consent). */
export async function currentConsentTx(
  tx: TenantTx,
  contactId: string,
  channel: ConsentInput['channel'],
  purpose: ConsentInput['purpose'],
): Promise<ConsentInput['status'] | null> {
  const [row] = await tx
    .select({ status: consents.status })
    .from(consents)
    .where(
      and(eq(consents.contactId, contactId), eq(consents.channel, channel), eq(consents.purpose, purpose)),
    )
    .orderBy(desc(consents.capturedAt), desc(consents.id))
    .limit(1);
  return (row?.status as ConsentInput['status'] | undefined) ?? null;
}

/** The org's contact for an email, if there is one (no merge-following yet). */
export async function contactIdByEmailTx(tx: TenantTx, email: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.emailNorm, normalizeEmail(email)));
  return row?.id ?? null;
}

/** Signed-in accounts linked to contacts (push notifications need a user). */
export async function contactUserIdsTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: contacts.id, userId: contacts.userId })
    .from(contacts)
    .where(inArray(contacts.id, [...contactIds]));
  return new Map(rows.filter((r) => r.userId).map((r) => [r.id, r.userId as string]));
}

/** The latest consent row per (channel, purpose) for a contact, with its evidence (M3.5a). */
export async function consentSummaryTx(
  tx: TenantTx,
  contactId: string,
): Promise<Map<string, { status: ConsentInput['status']; evidence: string; capturedAt: Date }>> {
  const rows = await tx
    .select({
      channel: consents.channel,
      purpose: consents.purpose,
      status: consents.status,
      evidence: consents.evidence,
      capturedAt: consents.capturedAt,
    })
    .from(consents)
    .where(eq(consents.contactId, contactId))
    .orderBy(desc(consents.capturedAt), desc(consents.id));
  const out = new Map<string, { status: ConsentInput['status']; evidence: string; capturedAt: Date }>();
  for (const r of rows) {
    const key = `${r.channel}:${r.purpose}`;
    if (!out.has(key))
      out.set(key, {
        status: r.status as ConsentInput['status'],
        evidence: r.evidence,
        capturedAt: r.capturedAt,
      });
  }
  return out;
}

/** A contact's email, name and phone (the preference center, M3.5a); null when unknown. */
export async function contactByIdTx(
  tx: TenantTx,
  contactId: string,
): Promise<{ id: string; email: string; name: string | null; phoneE164: string | null } | null> {
  const [row] = await tx
    .select({ id: contacts.id, email: contacts.email, name: contacts.name, phoneE164: contacts.phoneE164 })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  return row ?? null;
}

/** Contacts' names and emails by id (journey run history, M3.7a). Unknown ids are left out. */
export async function contactsByIdsTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, { email: string; name: string | null }>> {
  if (contactIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: contacts.id, email: contacts.email, name: contacts.name })
    .from(contacts)
    .where(inArray(contacts.id, [...new Set(contactIds)]));
  return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name }]));
}

/**
 * Ids of contacts whose email or name contains the text (case-insensitive, literal; a history
 * filter, M3.7a). Bounded.
 */
export async function contactIdsMatchingTx(tx: TenantTx, text: string, limit = 1000): Promise<string[]> {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      sql`position(${q} in lower(${contacts.email})) > 0 or position(${q} in lower(coalesce(${contacts.name}, ''))) > 0`,
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Contacts' phone numbers (texts to attendees, M3.5a). */
export async function contactPhonesTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: contacts.id, phone: contacts.phoneE164 })
    .from(contacts)
    .where(inArray(contacts.id, [...contactIds]));
  return new Map(rows.filter((r) => r.phone).map((r) => [r.id, r.phone as string]));
}

/** The org's contacts with this E.164 number (a text keyword such as STOP applies to each, M3.5b). */
export async function contactIdsByPhoneTx(tx: TenantTx, phoneE164: string): Promise<string[]> {
  const rows = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phoneE164));
  return rows.map((r) => r.id);
}

/** Set (or clear) a contact's E.164 phone number. */
export async function setContactPhoneTx(
  tx: TenantTx,
  ctx: Ctx,
  contactId: string,
  phoneE164: string | null,
): Promise<void> {
  await tx.update(contacts).set({ phoneE164, updatedAt: ctx.now }).where(eq(contacts.id, contactId));
}

export interface MarketingReach {
  readonly contactId: string;
  readonly email: string;
  readonly name: string | null;
  readonly phone: string | null;
  /** The latest marketing consent for the channel (null: none recorded, which means no consent). */
  readonly consent: ConsentInput['status'] | null;
  /** When that consent row was captured. */
  readonly consentAt: Date | null;
}

/**
 * Addresses and the latest marketing consent on one channel for many contacts at once (a
 * campaign's recipient snapshot, M3.6b). Merged contacts are left out (they have no reach of
 * their own). One statement per 5,000 contacts.
 */
export async function marketingReachTx(
  tx: TenantTx,
  contactIds: readonly string[],
  channel: ConsentInput['channel'],
): Promise<MarketingReach[]> {
  const out: MarketingReach[] = [];
  for (let i = 0; i < contactIds.length; i += 5_000) {
    const part = contactIds.slice(i, i + 5_000);
    const rows = await tx.execute<{
      id: string;
      email: string;
      name: string | null;
      phone_e164: string | null;
      status: string | null;
      captured_at: string | Date | null;
    }>(sql`
      select c.id, c.email, c.name, c.phone_e164, lc.status, lc.captured_at
      from crm.contacts c
      left join lateral (
        select k.status, k.captured_at from crm.consents k
        where k.org_id = c.org_id and k.contact_id = c.id and k.channel = ${channel} and k.purpose = 'marketing'
        order by k.captured_at desc, k.id desc
        limit 1
      ) lc on true
      where c.id = any(ARRAY[${sql.join(
        part.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])
        and c.merged_into is null`);
    for (const r of rows)
      out.push({
        contactId: r.id,
        email: r.email,
        name: r.name,
        phone: r.phone_e164,
        consent: (r.status as ConsentInput['status'] | null) ?? null,
        consentAt: r.captured_at === null ? null : new Date(r.captured_at),
      });
  }
  return out;
}

/** Names and addresses of contacts (a campaign releasing its next recipients, M3.6b). */
export async function contactsForSendTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, { email: string; name: string | null; phone: string | null }>> {
  if (contactIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: contacts.id, email: contacts.email, name: contacts.name, phone: contacts.phoneE164 })
    .from(contacts)
    .where(inArray(contacts.id, [...contactIds]));
  return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name, phone: r.phone }]));
}
