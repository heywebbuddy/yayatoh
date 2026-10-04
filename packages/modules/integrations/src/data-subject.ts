import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { connections, recordLinks, syncConflicts, syncErrors } from './schema.ts';

/**
 * The conflicts that are about the person (M6.4b): the inbox row's Yayatoh record is one of their
 * attendee records, or a kept or lost value is their address.
 */
async function conflictRowsTx(tx: TenantTx, s: DataSubject) {
  const attendees = refsOf(s, 'attendee');
  return tx
    .select({ c: syncConflicts, localId: syncErrors.localId })
    .from(syncConflicts)
    .innerJoin(
      syncErrors,
      and(eq(syncErrors.orgId, syncConflicts.orgId), eq(syncErrors.id, syncConflicts.errorId)),
    )
    .where(
      or(
        sql`lower(btrim(${syncConflicts.kept})) = ${s.email}`,
        sql`lower(btrim(${syncConflicts.lost})) = ${s.email}`,
        attendees.length ? inArray(syncErrors.localId, attendees) : undefined,
      ) as SQL,
    );
}

/**
 * The person's Yayatoh records a connector may have copied to (or from) a provider: CRM contacts
 * (demo, Salesforce contacts and leads), attendees and guests (Google Sheets, imports), their
 * registrations, orders and tickets (imports, campaign members).
 */
const LINKED_KINDS = ['contact', 'attendee', 'guest', 'registrant', 'order', 'ticket'] as const;
const linkedIdsOf = (s: DataSubject) => [...new Set(LINKED_KINDS.flatMap((k) => refsOf(s, k)))];

/** The person's record links and the inbox rows about their records (batch 3l merge). */
async function linkRowsTx(tx: TenantTx, s: DataSubject) {
  const ids = linkedIdsOf(s);
  if (ids.length === 0) return { links: [], errors: [] };
  const links = await tx
    .select({
      id: recordLinks.id,
      connector: connections.connector,
      objectType: recordLinks.objectType,
      lastSyncedAt: recordLinks.lastSyncedAt,
    })
    .from(recordLinks)
    .innerJoin(
      connections,
      and(eq(connections.orgId, recordLinks.orgId), eq(connections.id, recordLinks.connectionId)),
    )
    .where(inArray(recordLinks.localId, ids));
  const errors = await tx
    .select({ id: syncErrors.id })
    .from(syncErrors)
    .where(inArray(syncErrors.localId, ids));
  return { links, errors };
}

/**
 * Personal connections (M6.5c: a registrant's own Google Calendar) the person made. Their
 * `registrant_id` is the enrollment registrant: the ticket (M5.6a), so tickets count too.
 */
async function personalConnectionsTx(tx: TenantTx, s: DataSubject) {
  const registrants = [...new Set([...refsOf(s, 'registrant'), ...refsOf(s, 'ticket')])];
  if (registrants.length === 0) return [];
  return tx
    .select({ id: connections.id, connector: connections.connector, createdAt: connections.createdAt })
    .from(connections)
    .where(inArray(connections.registrantId, registrants));
}

/**
 * integrations' part of a data-subject request (M6.1c, M6.4b; batch 3l merge for every connector).
 * - The kept and lost values of a sync conflict waiting in the errors inbox: deleted.
 * - **Remote links** (`record_links`, every connector: Salesforce contacts and leads, Google Sheets
 *   rows, imported orders and attendees, calendar entries): erasure unlinks the person's records,
 *   so no connector pushes them again or matches a provider record to them; inbox rows about their
 *   records go too. Nothing is called at a provider here: the provider-side copy is the org's to
 *   delete there (UNVERIFIED adapters; see docs/owner-inbox.md, batch 3l).
 * - A **personal connection** (M6.5c, the registrant's own calendar) is deleted with its links,
 *   cursors and runs (cascade); the entries in the person's own calendar are theirs.
 * Slack messages, REST hooks and webhook endpoints carry no personal data (ids and counts only).
 */
export const integrationsDataSubjects = defineDataSubjectContributor({
  module: 'integrations',
  tables: {
    'integrations.sync_conflicts': DELETE,
    'integrations.record_links': DELETE,
    'integrations.sync_errors': DELETE,
    'integrations.connections': DELETE,
  },
  async export(tx, s) {
    const rows = await conflictRowsTx(tx, s);
    const { links } = await linkRowsTx(tx, s);
    const personal = await personalConnectionsTx(tx, s);
    return {
      sections: {
        // Which providers hold a copy, not the provider's record id (internal to the org's account).
        remoteLinks: links.map((l) => ({
          connector: l.connector,
          object: l.objectType,
          lastSyncedAt: l.lastSyncedAt,
        })),
        personalConnections: personal.map((c) => ({ connector: c.connector, createdAt: c.createdAt })),
        syncConflicts: rows.map(({ c, localId }) => ({
          recordId: localId,
          field: c.field,
          kept: c.kept,
          lost: c.lost,
          createdAt: c.createdAt,
        })),
      },
    };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const ids = (await conflictRowsTx(tx, s)).map((r) => r.c.id);
    if (ids.length) await tx.delete(syncConflicts).where(inArray(syncConflicts.id, ids));
    const { links, errors } = await linkRowsTx(tx, s);
    if (links.length)
      await tx.delete(recordLinks).where(
        inArray(
          recordLinks.id,
          links.map((l) => l.id),
        ),
      );
    if (errors.length)
      await tx.delete(syncErrors).where(
        inArray(
          syncErrors.id,
          errors.map((e) => e.id),
        ),
      );
    const personal = await personalConnectionsTx(tx, s);
    if (personal.length)
      await tx.delete(connections).where(
        inArray(
          connections.id,
          personal.map((c) => c.id),
        ),
      );
    return {
      erased: {
        'integrations.sync_conflicts': ids.length,
        'integrations.record_links': links.length,
        'integrations.sync_errors': errors.length,
        'integrations.connections': personal.length,
      },
    };
  },
});
