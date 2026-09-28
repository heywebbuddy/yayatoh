import { withTenant } from '@yayatoh/db';
import type { EventTarget } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { asc, eq } from 'drizzle-orm';
import {
  type PublicProgramDto,
  type PublicSessionDto,
  type PublicSpeakerPageDto,
  publicProgramSerializer,
  publicSpeakerPageSerializer,
  type SessionDto,
  type SpeakerDto,
} from './dto.ts';
import { exhibitorsOf, speakersOf, sponsorsOf, sponsorTiersOf } from './people.ts';
import { rooms, tracks } from './schema.ts';
import { sessionsOf } from './sessions.ts';

/**
 * The public program of an event that has a public page. Callers resolve the target first
 * (`pageTarget(slug)`, or an access-code–unlocked private event), exactly as for the page's
 * sections. Output goes through the allowlist serializer: no capacities, no org data.
 */
export async function publicProgram(target: EventTarget): Promise<PublicProgramDto> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const eventId = target.eventId;
    const roomRows = await tx.select().from(rooms).where(eq(rooms.eventId, eventId));
    const trackRows = await tx
      .select()
      .from(tracks)
      .where(eq(tracks.eventId, eventId))
      .orderBy(asc(tracks.name));
    const list = await sessionsOf(tx, eventId);
    const people = await speakersOf(tx, eventId);
    const exhibitorList = await exhibitorsOf(tx, eventId);
    const tiers = await sponsorTiersOf(tx, eventId);
    const sponsorList = await sponsorsOf(tx, eventId);
    const sessions = list.map((s) => toPublicSession(s, roomRows, trackRows, people));
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

function toPublicSession(
  s: SessionDto,
  roomRows: readonly { id: string; name: string }[],
  trackRows: readonly { id: string; name: string }[],
  people: readonly SpeakerDto[],
): PublicSessionDto {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    occurrenceId: s.occurrenceId,
    room: roomRows.find((r) => r.id === s.roomId)?.name ?? null,
    track: trackRows.find((t) => t.id === s.trackId)?.name ?? null,
    speakers: s.speakerIds.flatMap((id) => {
      const p = people.find((x) => x.id === id);
      return p ? [{ id: p.id, name: p.name }] : [];
    }),
  };
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
