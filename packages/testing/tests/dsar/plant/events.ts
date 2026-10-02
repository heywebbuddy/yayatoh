import { randomBytes } from 'node:crypto';
import type { Planter } from '../types.ts';
import { ensureSpeaker, portalAccountOf } from './program.ts';

/**
 * events: a speaker portal account for the person's address (its event-role grant, a sign-in code
 * and a signed-in session), issued for the speaker row that is them.
 */
export const plantEvents: Planter = async (p) => {
  const { admin, orgId, eventId, person, ids } = p;
  const speakerId = await ensureSpeaker(p);
  const accountId = portalAccountOf(ids);
  const [grant] = await admin`
    insert into events.event_role_assignments (org_id, event_id, user_id, role, expires_at)
    values (${orgId}, ${eventId}, ${accountId}, 'speaker', now() + interval '90 days')
    returning id`;
  await admin`
    insert into events.portal_accounts
      (id, org_id, event_id, assignment_id, role, subject_kind, subject_id, email, invited_at)
    values (${accountId}, ${orgId}, ${eventId}, ${grant?.id as string}, 'speaker', 'speaker', ${speakerId},
      ${person.email}, now())`;
  await admin`
    insert into events.portal_challenges (org_id, account_id, code_hash, expires_at)
    values (${orgId}, ${accountId}, ${randomBytes(32).toString('hex')}, now() + interval '10 minutes')`;
  await admin`
    insert into events.portal_sessions (org_id, account_id, token_hash, host, expires_at)
    values (${orgId}, ${accountId}, ${randomBytes(32).toString('hex')}, 'fixture.test', now() + interval '1 day')`;
  return [
    'events.portal_accounts',
    'events.portal_challenges',
    'events.portal_sessions',
    'events.event_role_assignments',
  ];
};
