import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ACCESS_MODES, DELIVERY_MODES } from './domain/access.ts';
import { VIDEO_PROVIDERS } from './provider/port.ts';

/** M6.10a: which ingest the encoder pushes to (RTMP overflow). */
export const INGESTS = ['primary', 'backup'] as const;
export type Ingest = (typeof INGESTS)[number];

/* ----------------------------------------------------------------------------- organizer ---- */

export const TicketAccessDto = z.object({
  ticketTypeId: z.uuid(),
  name: z.string(),
  /** The organizer's choice, or null (the event's default applies). */
  access: z.enum(ACCESS_MODES).nullable(),
  /** What holders get, all things considered. */
  effective: z.enum(ACCESS_MODES),
});
export type TicketAccessDto = z.infer<typeof TicketAccessDto>;

export const StreamDto = z.object({
  id: z.uuid(),
  provider: z.enum(VIDEO_PROVIDERS),
  ingestUrl: z.string(),
  enabled: z.boolean(),
  /** M6.10a: whether the provider offers a backup ingest, and which ingest is active. */
  hasBackup: z.boolean(),
  activeIngest: z.enum(INGESTS),
});
export type StreamDto = z.infer<typeof StreamDto>;

export const SetupSessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  stream: StreamDto.nullable(),
  /** Tickets that watched at least one minute. */
  viewers: z.number().int().nonnegative(),
  /** Minutes watched, all viewers together (the streaming meter for this session). */
  minutes: z.number().int().nonnegative(),
});
export type SetupSessionDto = z.infer<typeof SetupSessionDto>;

export const VirtualSetupDto = z.object({
  eventId: z.uuid(),
  deliveryMode: z.enum(DELIVERY_MODES),
  /** The configured provider, or null when streaming is off on this deployment. */
  provider: z.enum(VIDEO_PROVIDERS).nullable(),
  /** M6.10a: every provider a session may use here (the default first). */
  providers: z.array(
    z.object({ name: z.enum(VIDEO_PROVIDERS), kind: z.enum(['mux', 'cloudflare']), sandbox: z.boolean() }),
  ),
  ticketTypes: z.array(TicketAccessDto),
  sessions: z.array(SetupSessionDto),
});
export type VirtualSetupDto = z.infer<typeof VirtualSetupDto>;
export const virtualSetupSerializer = defineSerializer('virtual.setup', VirtualSetupDto);

export const StreamKeyDto = z.object({
  sessionId: z.uuid(),
  /** The ingest the encoder should push to now (the backup one after an overflow switch). */
  ingestUrl: z.string(),
  streamKey: z.string(),
  /** M6.10a: which ingest `ingestUrl` is, and the backup's address (null: none). */
  activeIngest: z.enum(INGESTS),
  backupIngestUrl: z.string().nullable(),
});
export type StreamKeyDto = z.infer<typeof StreamKeyDto>;

export const StreamingUsageDto = z.object({
  /** Viewer-minutes in the period (the D24 streaming meter). */
  viewerMinutes: z.number().int().nonnegative(),
  viewers: z.number().int().nonnegative(),
  /** M6.10a: viewer-minutes per provider (priced per provider, D24); `unknown` before M6.10a. */
  byProvider: z.array(
    z.object({
      provider: z.enum([...VIDEO_PROVIDERS, 'unknown']),
      viewerMinutes: z.number().int().nonnegative(),
    }),
  ),
});
export type StreamingUsageDto = z.infer<typeof StreamingUsageDto>;

/* -------------------------------------------------------------------------------- viewer ---- */

export const ViewerSessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  /** This ticket's minutes watched in the session. */
  minutes: z.number().int().nonnegative(),
});
export type ViewerSessionDto = z.infer<typeof ViewerSessionDto>;

/** What a ticket holder's watch page shows: no ids beyond the sessions', no other attendee. */
export const ViewerDto = z.object({
  eventName: z.string(),
  timezone: z.string(),
  holderName: z.string(),
  access: z.enum(ACCESS_MODES),
  sessions: z.array(ViewerSessionDto),
});
export type ViewerDto = z.infer<typeof ViewerDto>;
export const viewerSerializer = defineSerializer('virtual.viewer', ViewerDto);

export const PlaybackDto = z.object({
  sessionId: z.uuid(),
  token: z.string(),
  playbackUrl: z.string(),
  expiresAt: z.date(),
  provider: z.enum(VIDEO_PROVIDERS),
  /** M6.10a: a fake provider (the player shows a test pattern instead of loading video). */
  sandbox: z.boolean(),
});
export type PlaybackDto = z.infer<typeof PlaybackDto>;

export const HeartbeatDto = z.object({
  /** Whether this heartbeat added a minute. */
  counted: z.boolean(),
  /** Why it did not: the minute was already counted, a replayed sequence, or an expired token. */
  reason: z.enum(['counted', 'same_minute', 'replayed', 'expired']),
  /** This ticket's minutes in the session so far. */
  minutes: z.number().int().nonnegative(),
});
export type HeartbeatDto = z.infer<typeof HeartbeatDto>;

/* ---------------------------------------------------------------------- M6.9b: Zoom ---- */

export const ZoomSessionDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  /** The linked Zoom webinar's id, or null. */
  webinarId: z.string().nullable(),
  /** M6.10a: Yayatoh created the webinar through the org's Zoom connection. */
  created: z.boolean(),
  /** Holders with online access registered (or to register) for the webinar. */
  registrants: z.number().int().nonnegative(),
  /** Registered holders found in the webinar's attendance report. */
  attendees: z.number().int().nonnegative(),
});
export type ZoomSessionDto = z.infer<typeof ZoomSessionDto>;

export const ZoomSetupDto = z.object({ eventId: z.uuid(), sessions: z.array(ZoomSessionDto) });
export type ZoomSetupDto = z.infer<typeof ZoomSetupDto>;

export const ZoomSyncDto = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  webinarId: z.string().nullable(),
});
export type ZoomSyncDto = z.infer<typeof ZoomSyncDto>;
