import { randomUUID } from 'node:crypto';
import type { PlantCtx, Planter } from '../types.ts';

/**
 * The person as a speaker of the fixture's event (with their address as the speaker's contact),
 * made once and shared through `ids.speakerId` (events and media planters use it too).
 */
export async function ensureSpeaker({ admin, orgId, eventId, person, ids }: PlantCtx): Promise<string> {
  if (ids.speakerId) return ids.speakerId;
  const [sp] = await admin`
    insert into program.speakers (org_id, event_id, name, title, company, bio, links)
    values (${orgId}, ${eventId}, ${person.name}, ${`Head of ${person.lastName} Labs`}, ${`${person.lastName} Ltd`},
      ${`${person.name} talks about quills. Call ${person.phone}.`},
      ${admin.json([{ label: person.lastName, url: `https://example.test/${person.lastName}` }])})
    returning id`;
  ids.speakerId = sp?.id as string;
  await admin`
    insert into program.speaker_contacts (org_id, event_id, speaker_id, email)
    values (${orgId}, ${eventId}, ${ids.speakerId}, ${person.email})`;
  return ids.speakerId;
}

/** The person's portal account id (made by the events planter, or a stand-in when it has not run). */
export const portalAccountOf = (ids: Record<string, string>) => {
  ids.portalAccountId ??= randomUUID();
  return ids.portalAccountId;
};

/**
 * program: the person as a speaker (profile, contact address), a pending profile proposal, an
 * answered upload task and a place in a published agenda snapshot.
 */
export const plantProgram: Planter = async (p) => {
  const { admin, orgId, eventId, person, ids } = p;
  const speakerId = await ensureSpeaker(p);
  const account = portalAccountOf(ids);
  await admin`
    insert into program.speaker_changes (org_id, event_id, speaker_id, status, proposed, base, submitted_by)
    values (${orgId}, ${eventId}, ${speakerId}, 'pending',
      ${admin.json({ name: person.name, bio: `${person.name}, reachable at ${person.email}` })},
      ${admin.json({ name: person.name })}, ${account})`;
  let [task] = await admin`
    select id from program.portal_tasks
    where org_id = ${orgId} and event_id = ${eventId} and subject_kind = 'speaker' and kind = 'upload' limit 1`;
  if (!task)
    [task] = await admin`
      insert into program.portal_tasks (org_id, event_id, subject_kind, kind, title, due_at, created_by)
      values (${orgId}, ${eventId}, 'speaker', 'upload', 'Upload your slides', now() + interval '7 days', 'system')
      returning id`;
  ids.speakerFileId ??= randomUUID();
  const [assignee] = await admin`
    insert into program.portal_task_assignees
      (org_id, task_id, event_id, subject_id, status, completed_at, completed_by, file_id, file_name)
    values (${orgId}, ${task?.id as string}, ${eventId}, ${speakerId}, 'done', now(), ${account},
      ${ids.speakerFileId}, ${`${person.lastName}-slides.pdf`})
    returning id`;
  ids.speakerTaskAssigneeId = assignee?.id as string;
  // The first session of a published snapshot lists the person among its speakers.
  const [pub] = await admin`
    update program.agenda_publications
    set snapshot = jsonb_set(snapshot, '{0,speakers}',
      coalesce(snapshot->0->'speakers', '[]'::jsonb) || ${admin.json([{ id: speakerId, name: person.name }])})
    where id = (select id from program.agenda_publications
      where org_id = ${orgId} and state = 'published' and jsonb_array_length(snapshot) > 0 limit 1)
    returning id`;
  return [
    'program.speakers',
    'program.speaker_contacts',
    'program.speaker_changes',
    'program.portal_task_assignees',
    ...(pub ? ['program.agenda_publications'] : []),
  ];
};

/** Batch 3j merge (M5.3b): a proposal, a co-speaker place and a reviewer seat under the address. */
export const plantCfp: Planter = async ({ admin, orgId, person }) => {
  const tables: string[] = [];
  const [s] = await admin`
    update program.cfp_submissions set speaker_name = ${person.name}, speaker_email = ${person.email},
      speaker_company = ${`${person.lastName} Labs`}, speaker_bio = ${`Reach ${person.phone}`}
    where id = (select id from program.cfp_submissions where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (s) tables.push('program.cfp_submissions');
  const [c] = await admin`
    update program.cfp_co_speakers set name = ${person.name}, email = ${person.email}
    where id = (select id from program.cfp_co_speakers where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (c) tables.push('program.cfp_co_speakers');
  const [r] = await admin`
    update program.cfp_reviewers set name = ${person.name}, email = ${person.email}
    where id = (select id from program.cfp_reviewers where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (r) tables.push('program.cfp_reviewers');
  return tables;
};
