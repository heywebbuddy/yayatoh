import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  notSubject,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, eq, inArray } from 'drizzle-orm';
import { eventRoleAssignments } from './schema.ts';
import { portalAccounts, portalChallenges, portalSessions } from './schema-portal.ts';

/** The person's portal accounts (M5.3a): invitations sent to their address. */
async function accountsTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select({
      id: portalAccounts.id,
      assignmentId: portalAccounts.assignmentId,
      subjectKind: portalAccounts.subjectKind,
      subjectId: portalAccounts.subjectId,
    })
    .from(portalAccounts)
    .where(eq(portalAccounts.email, s.email));
}

/**
 * events' part of a data-subject request (M6.1c). The person's portal accounts (speaker,
 * exhibitor or sponsor contact invitations to their address) are deleted with their event-role
 * grant, sign-in codes and sessions. A speaker account names the speaker row it was issued for:
 * that speaker is the person (`speaker` refs, for program and media). Exhibitors and sponsors
 * are companies, not the person. Access codes, announcements and private info are the
 * organizer's content for ticket holders.
 */
export const eventsDataSubjects = defineDataSubjectContributor({
  module: 'events',
  tables: {
    'events.portal_accounts': DELETE,
    'events.portal_challenges': DELETE,
    'events.portal_sessions': DELETE,
    'events.event_role_assignments': DELETE,
    'events.access_codes': notSubject('access codes the organizer creates and hands out to ticket holders'),
    'events.event_announcements': notSubject(
      'the organizer’s announcements on an event page for its ticket holders',
    ),
    'events.event_private_info': notSubject(
      'the organizer’s private event details (join link, directions) shown to ticket holders',
    ),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await accountsTx(tx, s);
    if (rows.length === 0) return {};
    return {
      portal_account: rows.map((r) => r.id),
      speaker: rows.filter((r) => r.subjectKind === 'speaker').map((r) => r.subjectId),
    };
  },
  async export(tx, s): Promise<SubjectExport> {
    const rows = await tx
      .select({
        eventId: portalAccounts.eventId,
        role: portalAccounts.role,
        email: portalAccounts.email,
        invitedAt: portalAccounts.invitedAt,
        revokedAt: portalAccounts.revokedAt,
        lastSignInAt: portalAccounts.lastSignInAt,
      })
      .from(portalAccounts)
      .where(eq(portalAccounts.email, s.email))
      .orderBy(asc(portalAccounts.invitedAt));
    return { sections: { portalAccounts: rows } };
  },
  async erase(tx, s): Promise<SubjectErasure> {
    const rows = await accountsTx(tx, s);
    if (rows.length === 0) return { erased: {} };
    const ids = rows.map((r) => r.id);
    // Children first so the counts are exact; the grant goes last (it cascades to the account).
    const sessions = await tx
      .delete(portalSessions)
      .where(inArray(portalSessions.accountId, ids))
      .returning({ id: portalSessions.id });
    const challenges = await tx
      .delete(portalChallenges)
      .where(inArray(portalChallenges.accountId, ids))
      .returning({ id: portalChallenges.id });
    const accounts = await tx
      .delete(portalAccounts)
      .where(inArray(portalAccounts.id, ids))
      .returning({ id: portalAccounts.id });
    const grants = await tx
      .delete(eventRoleAssignments)
      .where(inArray(eventRoleAssignments.id, [...new Set(rows.map((r) => r.assignmentId))]))
      .returning({ id: eventRoleAssignments.id });
    return {
      erased: {
        'events.portal_accounts': accounts.length,
        'events.portal_challenges': challenges.length,
        'events.portal_sessions': sessions.length,
        'events.event_role_assignments': grants.length,
      },
    };
  },
});
