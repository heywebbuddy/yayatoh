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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { PublicSessionDto } from './dto.ts';
import { agendaHash, snapshotOf } from './public-session.ts';
import { agendaPublications, speakerContacts, speakers } from './schema.ts';
import { cfpCoSpeakers, cfpReviewers, cfpSubmissions } from './schema-cfp.ts';
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

/** `erased+<id>@erased.invalid`: unique per row (a call's proposals are unique per address and title). */
const erasedAddress = (id: AnyPgColumn) => sql`'erased+' || ${id}::text || '@erased.invalid'`;

const SnapshotSession = PublicSessionDto.extend({ startsAt: z.coerce.date(), endsAt: z.coerce.date() });

/**
 * program's part of a data-subject request (M5.2a, M5.3a, M6.1c). A speaker who is the person is
 * redacted in place: the session stays in the organizer's agenda, but the public profile (name,
 * title, company, bio, links) no longer names them, the published agenda snapshot shows the
 * placeholder, and their contact address, portal proposals and task uploads' names go (media
 * deletes the files and the photo). Exhibitors and sponsors are companies, not data subjects.
 *
 * Batch 3j merge (M5.3b call for papers): proposals the person submitted, co-speaker places and
 * reviewer seats under their address are exported and, on erasure, lose the name, address, job
 * title, company and bio (the talk's title and abstract stay with the organizer's review).
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
    'program.cfp_submissions': REDACT,
    'program.cfp_co_speakers': REDACT,
    'program.cfp_reviewers': REDACT,
    'program.sponsor_deliverables': notSubject(
      'owner_name is a free-text team label the organizer types ("Production team"), never keyed to a person',
    ),
    'program.sponsor_grants': notSubject('comp_code is a promo code the sponsor shares; it names no one'),
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
    const cfp = await tx
      .select()
      .from(cfpSubmissions)
      .where(eq(cfpSubmissions.speakerEmail, s.email))
      .orderBy(asc(cfpSubmissions.createdAt));
    const coSpeaking = await tx
      .select({ name: cfpCoSpeakers.name, email: cfpCoSpeakers.email, title: cfpSubmissions.title })
      .from(cfpCoSpeakers)
      .innerJoin(cfpSubmissions, eq(cfpSubmissions.id, cfpCoSpeakers.submissionId))
      .where(eq(cfpCoSpeakers.email, s.email));
    const reviewing = await tx
      .select({ eventId: cfpReviewers.eventId, name: cfpReviewers.name, email: cfpReviewers.email })
      .from(cfpReviewers)
      .where(eq(cfpReviewers.email, s.email));
    return {
      sections: {
        speakers: profiles,
        proposals,
        tasks: answers,
        callForPapers: cfp.map((x) => ({
          eventId: x.eventId,
          status: x.status,
          title: x.title,
          abstract: x.abstract,
          speakerName: x.speakerName,
          speakerEmail: x.speakerEmail,
          speakerTitle: x.speakerTitle,
          speakerCompany: x.speakerCompany,
          speakerBio: x.speakerBio,
          submittedAt: x.createdAt,
          decidedAt: x.decidedAt,
        })),
        coSpeaking,
        reviewing,
      },
    };
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
    const cfp = await tx
      .update(cfpSubmissions)
      .set({
        speakerName: ERASED_NAME,
        speakerEmail: erasedAddress(cfpSubmissions.id),
        speakerTitle: null,
        speakerCompany: null,
        speakerBio: '',
        updatedAt: now,
      })
      .where(eq(cfpSubmissions.speakerEmail, s.email))
      .returning({ id: cfpSubmissions.id });
    const coSpeakers = await tx
      .update(cfpCoSpeakers)
      .set({ name: ERASED_NAME, email: erasedAddress(cfpCoSpeakers.id) })
      .where(eq(cfpCoSpeakers.email, s.email))
      .returning({ id: cfpCoSpeakers.id });
    const reviewers = await tx
      .update(cfpReviewers)
      .set({ name: ERASED_NAME, email: erasedAddress(cfpReviewers.id) })
      .where(eq(cfpReviewers.email, s.email))
      .returning({ id: cfpReviewers.id });
    return {
      erased: {
        'program.cfp_submissions': cfp.length,
        'program.cfp_co_speakers': coSpeakers.length,
        'program.cfp_reviewers': reviewers.length,
        'program.speakers': profiles.length,
        'program.speaker_contacts': contacts.length,
        'program.speaker_changes': changes.length,
        'program.portal_task_assignees': answers.length,
        'program.agenda_publications': snapshots,
      },
    };
  },
});
