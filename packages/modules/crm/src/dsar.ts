import type { TenantTx } from '@yayatoh/db';
import { ERASED_EMAIL } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { consents, contactStats, contacts, eventParticipation } from './schema.ts';

/** A person's org contact and consent history, allowlisted (M1.14c data-subject access). */
export async function contactDsarTx(tx: TenantTx, emailNorm: string, linked: readonly string[] = []) {
  const rows = await tx
    .select()
    .from(contacts)
    .where(
      or(eq(contacts.emailNorm, emailNorm), linked.length ? inArray(contacts.id, [...linked]) : undefined),
    );
  const ids = rows.map((r) => r.id);
  const history = ids.length
    ? await tx
        .select()
        .from(consents)
        .where(inArray(consents.contactId, ids))
        .orderBy(asc(consents.capturedAt))
    : [];
  const participation = ids.length
    ? await tx
        .select()
        .from(eventParticipation)
        .where(inArray(eventParticipation.contactId, ids))
        .orderBy(asc(eventParticipation.registeredAt))
    : [];
  const stats = ids.length
    ? await tx.select().from(contactStats).where(inArray(contactStats.contactId, ids))
    : [];
  return {
    contacts: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phoneE164,
      source: r.source,
      createdAt: r.createdAt,
    })),
    consents: history.map((c) => ({
      channel: c.channel,
      purpose: c.purpose,
      status: c.status,
      evidence: c.evidence,
      capturedAt: c.capturedAt,
    })),
    participation: participation.map((p) => ({
      eventId: p.eventId,
      tickets: p.tickets,
      hasSeat: p.hasSeat,
      checkedIn: p.checkedIn,
      registeredAt: p.registeredAt,
      spendMinor: p.spendMinor,
      currency: p.currency,
    })),
    stats: stats.map((t) => ({
      currency: t.currency,
      orders: t.orders,
      tickets: t.tickets,
      events: t.events,
      eventsAttended: t.eventsAttended,
      spendMinor: t.spendMinor,
      firstSeenAt: t.firstSeenAt,
      lastSeenAt: t.lastSeenAt,
    })),
  };
}

/**
 * Erase a contact: email, name and phone are replaced (the row stays so attendee and order
 * references hold). Consent rows are kept as legal evidence; they carry no personal data.
 */
export async function eraseContactDsarTx(
  tx: TenantTx,
  emailNorm: string,
  now: Date,
  linked: readonly string[] = [],
) {
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      or(eq(contacts.emailNorm, emailNorm), linked.length ? inArray(contacts.id, [...linked]) : undefined),
    );
  for (const r of rows) {
    // email_norm is unique per org: make each erased contact's placeholder unique.
    const placeholder = ERASED_EMAIL.replace('@', `+${r.id}@`);
    await tx
      .update(contacts)
      .set({
        email: placeholder,
        emailNorm: placeholder,
        name: null,
        phoneE164: null,
        userId: null,
        updatedAt: now,
      })
      .where(eq(contacts.id, r.id));
  }
  const kept = rows.length
    ? (
        await tx
          .select({ id: consents.id })
          .from(consents)
          .where(
            inArray(
              consents.contactId,
              rows.map((r) => r.id),
            ),
          )
      ).length
    : 0;
  return { contactIds: rows.map((r) => r.id), erased: rows.length, consentsKept: kept };
}

/** The account is being deleted (M1.14e): the org's contacts stay, unlinked from the account. */
export async function unlinkContactUserTx(tx: TenantTx, userId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(contacts)
    .set({ userId: null, updatedAt: now })
    .where(eq(contacts.userId, userId))
    .returning({ id: contacts.id });
  return rows.length;
}

/**
 * Whether the org holds a marketing consent for this email that was granted after `since` and
 * is still the latest (M1.14e: after an erasure, consent must be given again before marketing).
 */
export async function consentRegivenSinceTx(
  tx: TenantTx,
  emailNorm: string,
  channel: 'email' | 'sms',
  since: Date,
): Promise<boolean> {
  const rows = await tx
    .select({ status: consents.status, capturedAt: consents.capturedAt })
    .from(consents)
    .innerJoin(contacts, and(eq(contacts.orgId, consents.orgId), eq(contacts.id, consents.contactId)))
    .where(
      and(
        eq(contacts.emailNorm, emailNorm),
        eq(consents.channel, channel),
        eq(consents.purpose, 'marketing'),
      ),
    )
    .orderBy(desc(consents.capturedAt), desc(consents.id))
    .limit(1);
  const latest = rows[0];
  return Boolean(latest && latest.status === 'granted' && latest.capturedAt > since);
}
