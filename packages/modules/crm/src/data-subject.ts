import type { TenantTx } from '@yayatoh/db';
import {
  DELETE,
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_NAME,
  hold,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { eq, inArray, or } from 'drizzle-orm';
import { contactDsarTx, eraseContactDsarTx } from './dsar.ts';
import { consents, contactProfile, contactStats, contacts, eventParticipation } from './schema.ts';

/** The person's contacts: by address, and any contact another module linked to them. */
async function contactIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const linked = refsOf(s, 'contact');
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(or(eq(contacts.emailNorm, s.email), linked.length ? inArray(contacts.id, linked) : undefined));
  return rows.map((r) => r.id);
}

/**
 * crm's part of a data-subject request (M6.1c). Contacts are redacted in place (attendee, order
 * and consent rows point at them); consent history is kept as proof of lawful marketing
 * (accountability) with the free-text evidence cleared; the projections built from other modules
 * (participation, profile, stats) are deleted: they are rebuilt from the redacted sources if new
 * activity arrives.
 */
export const crmDataSubjects = defineDataSubjectContributor({
  module: 'crm',
  tables: {
    'crm.contacts': REDACT,
    'crm.consents': hold('accountability'),
    'crm.event_participation': DELETE,
    'crm.contact_profile': DELETE,
    'crm.contact_stats': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const ids = await contactIdsTx(tx, s);
    if (ids.length === 0) return {};
    const rows = await tx
      .select({ name: contacts.name, phone: contacts.phoneE164 })
      .from(contacts)
      .where(inArray(contacts.id, ids));
    return {
      contact: ids,
      name: rows.flatMap((r) => (r.name ? [r.name] : [])),
      phone: rows.flatMap((r) => (r.phone ? [r.phone] : [])),
    };
  },
  async export(tx, s) {
    const ids = await contactIdsTx(tx, s);
    const d = await contactDsarTx(tx, s.email, ids);
    return {
      sections: {
        contacts: d.contacts.map(({ id: _id, ...c }) => c),
        consents: d.consents,
        participation: d.participation,
        stats: d.stats,
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = await contactIdsTx(tx, s);
    if (ids.length === 0) return { erased: {} };
    const participation = await tx
      .delete(eventParticipation)
      .where(inArray(eventParticipation.contactId, ids))
      .returning({ id: eventParticipation.id });
    const profile = await tx
      .delete(contactProfile)
      .where(inArray(contactProfile.contactId, ids))
      .returning({ id: contactProfile.id });
    const stats = await tx
      .delete(contactStats)
      .where(inArray(contactStats.contactId, ids))
      .returning({ id: contactStats.id });
    const kept = await tx
      .update(consents)
      .set({ evidence: ERASED_NAME, updatedAt: ctx.now })
      .where(inArray(consents.contactId, ids))
      .returning({ id: consents.id, status: consents.status, purpose: consents.purpose });
    const r = await eraseContactDsarTx(tx, s.email, ctx.now, ids);
    return {
      erased: {
        'crm.contacts': r.erased,
        'crm.event_participation': participation.length,
        'crm.contact_profile': profile.length,
        'crm.contact_stats': stats.length,
      },
      held: kept.map((c) => ({
        table: 'crm.consents',
        id: c.id,
        ref: `${c.purpose}:${c.status}`,
        basis: 'accountability' as const,
      })),
    };
  },
});
