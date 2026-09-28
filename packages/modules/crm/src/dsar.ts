import type { TenantTx } from '@yayatoh/db';
import { ERASED_EMAIL } from '@yayatoh/platform';
import { asc, eq, inArray } from 'drizzle-orm';
import { consents, contactStats, contacts, eventParticipation } from './schema.ts';

/** A person's org contact and consent history, allowlisted (M1.14c data-subject access). */
export async function contactDsarTx(tx: TenantTx, emailNorm: string) {
  const rows = await tx.select().from(contacts).where(eq(contacts.emailNorm, emailNorm));
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
export async function eraseContactDsarTx(tx: TenantTx, emailNorm: string, now: Date) {
  const rows = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.emailNorm, emailNorm));
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
