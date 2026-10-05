import { withTenant } from '@yayatoh/db';
import type { EventTarget } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import {
  type PublicProgramDto,
  type PublicSpeakerPageDto,
  publicProgramSerializer,
  publicSpeakerPageSerializer,
} from './dto.ts';
import { unlistedExhibitorIdsTx } from './exhibitor-portal.ts';
import { exhibitorsOf, speakersOf, sponsorsOf, sponsorTiersOf } from './people.ts';
import { currentPublicSessionsTx, draftOnlySpeakerIdsTx, servedPublicSessionsTx } from './public-session.ts';

/**
 * The public program of an event that has a public page. Callers resolve the target first
 * (`pageTarget(slug)`, or an access-code–unlocked private event), exactly as for the page's
 * sections. Output goes through the allowlist serializer: no capacities, no org data.
 */
export async function publicProgram(target: EventTarget): Promise<PublicProgramDto> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const eventId = target.eventId;
    // M5.2a: a published agenda serves its snapshot; a draft serves no sessions.
    const sessions = await servedPublicSessionsTx(tx, eventId, () => currentPublicSessionsTx(tx, eventId));
    // M5.3b: a speaker whose only sessions are drafts (an accepted proposal) is not announced yet.
    const unannounced = await draftOnlySpeakerIdsTx(tx, eventId);
    const people = (await speakersOf(tx, eventId)).filter((p) => !unannounced.has(p.id));
    // M5.4a: exhibitors the organizer unlisted never reach the public page.
    const unlisted = await unlistedExhibitorIdsTx(tx, eventId);
    const exhibitorList = (await exhibitorsOf(tx, eventId)).filter((x) => !unlisted.has(x.id));
    const tiers = await sponsorTiersOf(tx, eventId);
    const sponsorList = await sponsorsOf(tx, eventId);
    return publicProgramSerializer.serialize({
      sessions,
      speakers: people,
      exhibitors: exhibitorList,
      sponsorTiers: tiers
        .map((t) => ({ name: t.name, sponsors: sponsorList.filter((s) => s.tierId === t.id) }))
        .filter((t) => t.sponsors.length > 0),
    });
  });
}

/** One speaker's public page: their profile and their sessions. Null for an unknown speaker. */
export async function publicSpeaker(
  target: EventTarget,
  speakerId: string,
): Promise<PublicSpeakerPageDto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(speakerId)) return null;
  const program = await publicProgram(target);
  const speaker = program.speakers.find((s) => s.id === speakerId);
  if (!speaker) return null;
  return publicSpeakerPageSerializer.serialize({
    speaker,
    sessions: program.sessions.filter((s) => s.speakers.some((p) => p.id === speakerId)),
  });
}
