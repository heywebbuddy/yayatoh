import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';

export const LinkDto = z.object({ label: z.string(), url: z.string() });

export const TrackDto = z.object({ id: z.uuid(), eventId: z.uuid(), name: z.string() });
export type TrackDto = z.infer<typeof TrackDto>;

export const RoomDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  capacity: z.number().int().nullable(),
});
export type RoomDto = z.infer<typeof RoomDto>;

export const SessionDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  occurrenceId: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomId: z.uuid().nullable(),
  trackId: z.uuid().nullable(),
  capacity: z.number().int().nullable(),
  speakerIds: z.array(z.uuid()),
});
export type SessionDto = z.infer<typeof SessionDto>;

export const SpeakerDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string(),
  links: z.array(LinkDto),
});
export type SpeakerDto = z.infer<typeof SpeakerDto>;

export const ExhibitorDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  description: z.string(),
  boothLabel: z.string().nullable(),
  websiteUrl: z.string().nullable(),
});
export type ExhibitorDto = z.infer<typeof ExhibitorDto>;

export const SponsorTierDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  position: z.number().int(),
});
export type SponsorTierDto = z.infer<typeof SponsorTierDto>;

export const SponsorDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  tierId: z.uuid(),
  name: z.string(),
  description: z.string(),
  websiteUrl: z.string().nullable(),
});
export type SponsorDto = z.infer<typeof SponsorDto>;

export const WARNING_KINDS = ['room_overlap', 'speaker_overlap', 'outside_event'] as const;
export const ScheduleWarningDto = z.object({
  kind: z.enum(WARNING_KINDS),
  sessionId: z.uuid(),
  otherId: z.uuid().nullable(),
  roomId: z.uuid().nullable(),
  speakerId: z.uuid().nullable(),
});
export type ScheduleWarningDto = z.infer<typeof ScheduleWarningDto>;

/** Everything the organizer console shows for one event's program. */
export const ProgramDto = z.object({
  tracks: z.array(TrackDto),
  rooms: z.array(RoomDto),
  sessions: z.array(SessionDto),
  speakers: z.array(SpeakerDto),
  exhibitors: z.array(ExhibitorDto),
  sponsorTiers: z.array(SponsorTierDto),
  sponsors: z.array(SponsorDto),
  warnings: z.array(ScheduleWarningDto),
});
export type ProgramDto = z.infer<typeof ProgramDto>;

export const SessionResultDto = z.object({
  session: SessionDto,
  /** Conflicts that involve this session after the write (warnings; the write still happened). */
  warnings: z.array(ScheduleWarningDto),
});
export type SessionResultDto = z.infer<typeof SessionResultDto>;

/* ---------------------------------------------------------------- public (allowlisted) ---- */

const PublicSpeakerRef = z.object({ id: z.uuid(), name: z.string() });

export const PublicSessionDto = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  occurrenceId: z.uuid().nullable(),
  room: z.string().nullable(),
  track: z.string().nullable(),
  speakers: z.array(PublicSpeakerRef),
  /** M5.2a: the session type's name ("Workshop") and whether it is included or optional. */
  type: z.string().nullable(),
  admission: z.enum(['included', 'optional']),
});
export type PublicSessionDto = z.infer<typeof PublicSessionDto>;

export const PublicSpeakerDto = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string(),
  links: z.array(LinkDto),
});
export type PublicSpeakerDto = z.infer<typeof PublicSpeakerDto>;

export const PublicExhibitorDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  boothLabel: z.string().nullable(),
  websiteUrl: z.string().nullable(),
});

export const PublicSponsorTierDto = z.object({
  name: z.string(),
  sponsors: z.array(
    z.object({ id: z.uuid(), name: z.string(), description: z.string(), websiteUrl: z.string().nullable() }),
  ),
});

/** The public page's program: no capacities, no internal ids beyond row ids, no org data. */
export const PublicProgramDto = z.object({
  sessions: z.array(PublicSessionDto),
  speakers: z.array(PublicSpeakerDto),
  exhibitors: z.array(PublicExhibitorDto),
  sponsorTiers: z.array(PublicSponsorTierDto),
});
export type PublicProgramDto = z.infer<typeof PublicProgramDto>;
export const publicProgramSerializer = defineSerializer('program.publicProgram', PublicProgramDto);

export const PublicSpeakerPageDto = z.object({
  speaker: PublicSpeakerDto,
  sessions: z.array(PublicSessionDto),
});
export type PublicSpeakerPageDto = z.infer<typeof PublicSpeakerPageDto>;
export const publicSpeakerPageSerializer = defineSerializer('program.publicSpeaker', PublicSpeakerPageDto);
