import { createHash } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PublicSessionDto, type SessionDto, type SpeakerDto } from './dto.ts';
import { speakersOf } from './people.ts';
import { agendaPublications, rooms, sessionDetails, sessionTypes, tracks } from './schema.ts';
import { sessionsOf } from './sessions.ts';

type Named = { readonly id: string; readonly name: string };
type Details = { readonly sessionId: string; readonly typeId: string | null; readonly admission: string };

/** One session in its public (allowlisted) shape: names, not ids, and no capacities. */
export function toPublicSession(
  s: SessionDto,
  roomRows: readonly Named[],
  trackRows: readonly Named[],
  people: readonly SpeakerDto[],
  details: readonly Details[] = [],
  types: readonly Named[] = [],
): PublicSessionDto {
  const d = details.find((x) => x.sessionId === s.id);
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
    type: types.find((t) => t.id === d?.typeId)?.name ?? null,
    admission: d?.admission === 'optional' ? 'optional' : 'included',
  };
}

/** The event's agenda as it is now, in its public shape (what "Publish" would snapshot). */
export async function currentPublicSessionsTx(tx: TenantTx, eventId: string): Promise<PublicSessionDto[]> {
  // One transaction connection: read in sequence.
  const roomRows = await tx
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(eq(rooms.eventId, eventId));
  const trackRows = await tx
    .select({ id: tracks.id, name: tracks.name })
    .from(tracks)
    .where(eq(tracks.eventId, eventId))
    .orderBy(asc(tracks.name));
  const typeRows = await tx
    .select({ id: sessionTypes.id, name: sessionTypes.name })
    .from(sessionTypes)
    .where(eq(sessionTypes.eventId, eventId));
  const details = await tx
    .select({
      sessionId: sessionDetails.sessionId,
      typeId: sessionDetails.typeId,
      admission: sessionDetails.admission,
    })
    .from(sessionDetails)
    .where(eq(sessionDetails.eventId, eventId));
  const list = await sessionsOf(tx, eventId);
  const people = await speakersOf(tx, eventId);
  return list.map((s) => toPublicSession(s, roomRows, trackRows, people, details, typeRows));
}

const ordered = (sessions: readonly PublicSessionDto[]) =>
  [...sessions].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.endsAt.getTime() - b.endsAt.getTime() ||
      a.title.localeCompare(b.title) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

/** The snapshot as stored: the allowlisted shape (dates as ISO strings), in a stable order. */
export function snapshotOf(sessions: readonly PublicSessionDto[]): unknown[] {
  return ordered(sessions).map((s) => {
    const p = PublicSessionDto.parse(s);
    return { ...p, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString() };
  });
}

/** A stable fingerprint of the public agenda: "changed since publish" compares these. */
export function agendaHash(sessions: readonly PublicSessionDto[]): string {
  return createHash('sha256')
    .update(JSON.stringify(snapshotOf(sessions)))
    .digest('hex');
}

const SnapshotSession = PublicSessionDto.extend({ startsAt: z.coerce.date(), endsAt: z.coerce.date() });

/**
 * What the public sees (M5.2a publishing states): a live agenda (never drafted or published)
 * shows the current sessions; a draft shows none; a published agenda shows its snapshot, even
 * after later changes, until the organizer publishes again.
 */
export async function servedPublicSessionsTx(
  tx: TenantTx,
  eventId: string,
  current: () => Promise<PublicSessionDto[]>,
): Promise<PublicSessionDto[]> {
  const [pub] = await tx
    .select({ state: agendaPublications.state, snapshot: agendaPublications.snapshot })
    .from(agendaPublications)
    .where(eq(agendaPublications.eventId, eventId));
  if (!pub) return current();
  if (pub.state !== 'published') return [];
  return z.array(SnapshotSession).parse(pub.snapshot ?? []);
}
