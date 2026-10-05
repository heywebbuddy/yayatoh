import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  notSubject,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import { admissionsDsarTx } from './dsar.ts';
import { fraudSignals } from './schema.ts';

/** Fraud signals about the person: their contacts, their orders and the tickets they hold. */
function aboutSubject(s: DataSubject): SQL | undefined {
  const contacts = refsOf(s, 'contact');
  const orders = refsOf(s, 'order');
  const held = refsOf(s, 'ticket');
  return or(
    contacts.length ? inArray(fraudSignals.contactId, contacts) : undefined,
    orders.length ? inArray(fraudSignals.orderId, orders) : undefined,
    held.length ? inArray(fraudSignals.ticketId, held) : undefined,
  );
}

/**
 * checkin's part of a data-subject request (M6.1c). Admissions and the scan log hold ticket ids
 * and times only; they are kept (check-in counts) and point at no one once ticketing redacts the
 * ticket. Fraud signals about the person stay (security history: kind, severity, ids) but lose
 * the staff's free-text triage note, which may name them. Exported: when their tickets were
 * admitted. Signals are internal security records and are not exported.
 */
export const checkinDataSubjects = defineDataSubjectContributor({
  module: 'checkin',
  tables: {
    'checkin.fraud_signals': REDACT,
    'checkin.admissions': notSubject(
      'check-in counts: ticket ids, days and times only, no personal data; the ticket is redacted by ticketing',
    ),
    'checkin.scans': notSubject(
      'the scan log: ticket ids, results and device timing only, no personal data; purged after 12 months',
    ),
  },
  async export(tx: TenantTx, s) {
    return { sections: { admissions: await admissionsDsarTx(tx, refsOf(s, 'ticket')) } };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const about = aboutSubject(s);
    const notes = about
      ? await tx
          .update(fraudSignals)
          .set({ resolutionNote: null, updatedAt: ctx.now })
          .where(and(about, isNotNull(fraudSignals.resolutionNote)))
          .returning({ id: fraudSignals.id })
      : [];
    return { erased: { 'checkin.fraud_signals': notes.length } };
  },
});
