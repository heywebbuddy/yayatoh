import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_NAME,
  notSubject,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PublicSessionDto } from './dto.ts';
import { agendaHash, snapshotOf } from './public-session.ts';
import { agendaPublications, speakerContacts, speakers } from './schema.ts';
import { portalTaskAssignees, portalTasks, speakerChanges } from './schema-portal.ts';

/**
 * The speaker rows that are the person: their address on the speaker (M5.2a contacts) and the
 * speakers their portal accounts were issued for (events resolves those).
 */
async function speakerIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const rows = await tx
    .select({ id: speakerContacts.speakerId })
    .from(speakerContacts)
    .where(eq(speakerContacts.email, s.email));
  const linked = refsOf(s, 'speaker');
  const known = linked.length
    ? await tx.select({ id: speakers.id }).from(speakers).where(inArray(speakers.id, linked))
    : [];
  return [...new Set([...rows.map((r) => r.id), ...known.map((r) => r.id)])];
}

/** The person's task rows: tasks of their speakers, and answers their portal accounts gave. */
async function assigneeIdsTx(tx: TenantTx, speakerIds: readonly string[], accounts: readonly string[]) {
  if (speakerIds.length === 0 && accounts.length === 0) return [];
  const rows = await tx
    .select({ id: portalTaskAssignees.id })
    .from(portalTaskAssignees)
    .where(
      or(
        speakerIds.length ? inArray(portalTaskAssignees.subjectId, [...speakerIds]) : undefined,
        accounts.length ? inArray(portalTaskAssignees.completedBy, [...accounts]) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

const SnapshotSession = PublicSessionDto.extend({ startsAt: z.coerce.date(), endsAt: z.coerce.date() });

/**
 * program's part of a data-subject request (M5.2a, M5.3a, M6.1c). A speaker who is the person is
 * redacted in place: the session stays in the organizer's agenda, but the public profile (name,
 * title, company, bio, links) no longer names them, the published agenda snapshot shows the
 * placeholder, and their contact address, portal proposals and task uploads' names go (media
 * deletes the files and the photo). Exhibitors and sponsors are companies, not data subjects.
 */
export const programDataSubjects = defineDataSubjectContributor({
  module: 'program',
  tables: {
    'program.speakers': REDACT,
    'program.speaker_contacts': DELETE,
    'program.speaker_changes': DELETE,
    'program.portal_task_assignees': REDACT,
    'program.agenda_publications': REDACT,
    'program.portal_tasks': notSubject('task titles, instructions and agreement texts the organizer writes'),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const ids = await speakerIdsTx(tx, s);
    if (ids.length === 0) return {};
    const rows = await tx.select({ name: speakers.name }).from(speakers).where(inArray(speakers.id, ids));
    const tasks = await assigneeIdsTx(tx, ids, []);
    return {
      speaker: ids,
      portal_task_assignee: tasks,
      name: rows.map((r) => r.name).filter((n) => n !== ERASED_NAME),
    };
  },
  async export(tx, s): Promise<SubjectExport> {
    const ids = await speakerIdsTx(tx, s);
    const tasks = await assigneeIdsTx(tx, ids, refsOf(s, 'portal_account'));
    const profiles = ids.length
      ? await tx
          .select({
            eventId: speakers.eventId,
            name: speakers.name,
            title: speakers.title,
            company: speakers.company,
            bio: speakers.bio,
            links: speakers.links,
            email: speakerContacts.email,
          })
          .from(speakers)
          .leftJoin(speakerContacts, eq(speakerContacts.speakerId, speakers.id))
          .where(inArray(speakers.id, ids))
      : [];
    const proposals = ids.length
      ? await tx
          .select({
            eventId: speakerChanges.eventId,
            sessionId: speakerChanges.sessionId,
            status: speakerChanges.status,
            proposed: speakerChanges.proposed,
            proposedAt: speakerChanges.createdAt,
            decidedAt: speakerChanges.decidedAt,
          })
          .from(speakerChanges)
          .where(inArray(speakerChanges.speakerId, ids))
          .orderBy(asc(speakerChanges.createdAt))
      : [];
    const answers = tasks.length
      ? await tx
          .select({
            eventId: portalTaskAssignees.eventId,
            task: portalTasks.title,
            kind: portalTasks.kind,
            dueAt: portalTasks.dueAt,
            status: portalTaskAssignees.status,
            completedAt: portalTaskAssignees.completedAt,
            fileName: portalTaskAssignees.fileName,
          })
          .from(portalTaskAssignees)
          .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
          .where(inArray(portalTaskAssignees.id, tasks))
          .orderBy(asc(portalTasks.dueAt))
      : [];
    return { sections: { speakers: profiles, proposals, tasks: answers } };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const ids = await speakerIdsTx(tx, s);
    const accounts = refsOf(s, 'portal_account');
    const tasks = await assigneeIdsTx(tx, ids, accounts);
    const answers = tasks.length
      ? await tx
          .update(portalTaskAssignees)
          .set({ fileId: null, fileName: null, completedBy: null, updatedAt: now })
          .where(inArray(portalTaskAssignees.id, tasks))
          .returning({ id: portalTaskAssignees.id })
      : [];
    const changes =
      ids.length || accounts.length
        ? await tx
            .delete(speakerChanges)
            .where(
              or(
                ids.length ? inArray(speakerChanges.speakerId, ids) : undefined,
                accounts.length ? inArray(speakerChanges.submittedBy, accounts) : undefined,
              ),
            )
            .returning({ id: speakerChanges.id })
        : [];
    const contacts = await tx
      .delete(speakerContacts)
      .where(
        or(
          eq(speakerContacts.email, s.email),
          ids.length ? inArray(speakerContacts.speakerId, ids) : undefined,
        ),
      )
      .returning({ id: speakerContacts.id });
    const profiles = ids.length
      ? await tx
          .update(speakers)
          .set({
            name: ERASED_NAME,
            title: null,
            company: null,
            bio: '',
            links: sql`'[]'::jsonb`,
            updatedAt: now,
          })
          .where(inArray(speakers.id, ids))
          .returning({ id: speakers.id })
      : [];
    // Published agenda snapshots name the speaker: show the placeholder there too, and re-hash
    // so the agenda does not read as "changed since publish" because of the erasure.
    let snapshots = 0;
    if (ids.length) {
      const mine = new Set(ids);
      const pubs = await tx
        .select({ id: agendaPublications.id, snapshot: agendaPublications.snapshot })
        .from(agendaPublications)
        .where(isNotNull(agendaPublications.snapshot));
      for (const p of pubs) {
        if (!Array.isArray(p.snapshot)) continue;
        const sessions = p.snapshot.map((x) => SnapshotSession.parse(x));
        if (!sessions.some((x) => x.speakers.some((sp) => mine.has(sp.id)))) continue;
        const next = sessions.map((x) => ({
          ...x,
          speakers: x.speakers.map((sp) => (mine.has(sp.id) ? { ...sp, name: ERASED_NAME } : sp)),
        }));
        await tx
          .update(agendaPublications)
          .set({ snapshot: snapshotOf(next), snapshotHash: agendaHash(next), updatedAt: now })
          .where(eq(agendaPublications.id, p.id));
        snapshots += 1;
      }
    }
    return {
      erased: {
        'program.speakers': profiles.length,
        'program.speaker_contacts': contacts.length,
        'program.speaker_changes': changes.length,
        'program.portal_task_assignees': answers.length,
        'program.agenda_publications': snapshots,
      },
    };
  },
});
