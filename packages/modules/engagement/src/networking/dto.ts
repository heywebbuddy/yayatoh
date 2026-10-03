import { z } from 'zod';
import {
  CONNECTION_STATES,
  LOCATION_KINDS,
  MEETING_STATES,
  REPORT_REASONS,
  REPORT_STATES,
} from '../schema.ts';

/**
 * Allowlisted shapes of networking (M5.8a). Attendee-facing shapes carry another person only as
 * the profile they chose to show (name, job title, company, interests, bio): never their email,
 * contact, attendee record or ticket. A person who has not opted in, opted out, was hidden by the
 * organizer, or blocked (either way) never appears in any of them.
 */
export const LocationKindDto = z.enum(LOCATION_KINDS);

/** Another attendee as the directory shows them. */
export const PersonDto = z.object({
  id: z.uuid(),
  displayName: z.string(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
  interests: z.array(z.string()),
  /** Where the viewer stands with them. */
  connection: z.enum(['none', 'pending_out', 'pending_in', 'connected']),
});
export type PersonDto = z.infer<typeof PersonDto>;

export const PersonDetailDto = PersonDto.extend({
  bio: z.string().nullable(),
  /** The pending request between them, when there is one (to answer or withdraw it). */
  connectionId: z.uuid().nullable(),
});
export type PersonDetailDto = z.infer<typeof PersonDetailDto>;

/** A person named on a request or meeting: the profile basics only. */
export const PersonRefDto = z.object({
  id: z.uuid(),
  displayName: z.string(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
});
export type PersonRefDto = z.infer<typeof PersonRefDto>;

/** The viewer's own profile (null fields mean "not given"). */
export const MyProfileDto = z.object({
  optedIn: z.boolean(),
  hidden: z.boolean(),
  displayName: z.string(),
  headline: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  interests: z.array(z.string()),
});
export type MyProfileDto = z.infer<typeof MyProfileDto>;

/** The networking home of one verified attendee. */
export const NetworkHomeDto = z.object({
  eventName: z.string(),
  /** The event's IANA zone: slots and meetings render in it. */
  timeZone: z.string(),
  meetingsEnabled: z.boolean(),
  /** Their name on the registration, to start a profile from. */
  attendeeName: z.string(),
  profile: MyProfileDto.nullable(),
});
export type NetworkHomeDto = z.infer<typeof NetworkHomeDto>;

export const DirectoryDto = z.object({
  people: z.array(PersonDto),
  total: z.int().min(0),
  page: z.int().min(1),
  pages: z.int().min(1),
});
export type DirectoryDto = z.infer<typeof DirectoryDto>;

export const ConnectionDto = z.object({
  id: z.uuid(),
  direction: z.enum(['incoming', 'outgoing']),
  status: z.enum(CONNECTION_STATES),
  message: z.string().nullable(),
  person: PersonRefDto,
  createdAt: z.date(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;

export const MyConnectionsDto = z.object({
  incoming: z.array(ConnectionDto),
  outgoing: z.array(ConnectionDto),
  connected: z.array(ConnectionDto),
});
export type MyConnectionsDto = z.infer<typeof MyConnectionsDto>;

export const SlotDto = z.object({ id: z.uuid(), startsAt: z.date(), endsAt: z.date() });
export type SlotDto = z.infer<typeof SlotDto>;
export const LocationRefDto = z.object({ id: z.uuid(), name: z.string(), kind: LocationKindDto });
export type LocationRefDto = z.infer<typeof LocationRefDto>;

export const MeetingDto = z.object({
  id: z.uuid(),
  direction: z.enum(['incoming', 'outgoing']),
  status: z.enum(MEETING_STATES),
  message: z.string().nullable(),
  person: PersonRefDto,
  slot: SlotDto,
  location: LocationRefDto,
  /** The table at the location, once accepted. */
  tableNo: z.int().nullable(),
  createdAt: z.date(),
});
export type MeetingDto = z.infer<typeof MeetingDto>;

export const MyMeetingsDto = z.object({
  incoming: z.array(MeetingDto),
  outgoing: z.array(MeetingDto),
  upcoming: z.array(MeetingDto),
  /** For the request form: slots still ahead, and the locations. */
  slots: z.array(SlotDto),
  locations: z.array(LocationRefDto),
});
export type MyMeetingsDto = z.infer<typeof MyMeetingsDto>;

export const BlockedDto = z.object({ id: z.uuid(), displayName: z.string() });
export type BlockedDto = z.infer<typeof BlockedDto>;

/** An accepted meeting's calendar file. */
export const MeetingIcsDto = z.object({ filename: z.string(), ics: z.string() });

/* --------------------------------------------------------------------------- console ---- */

export const NetworkSettingsDto = z.object({ enabled: z.boolean(), meetingsEnabled: z.boolean() });
export type NetworkSettingsDto = z.infer<typeof NetworkSettingsDto>;

export const ConsoleLocationDto = LocationRefDto.extend({
  capacity: z.int().min(1),
  /** Accepted meetings at this location (all slots). */
  booked: z.int().min(0),
  /** The most accepted meetings it holds in any one slot. */
  peak: z.int().min(0),
});
export type ConsoleLocationDto = z.infer<typeof ConsoleLocationDto>;

export const ConsoleSlotDto = SlotDto.extend({ booked: z.int().min(0) });
export type ConsoleSlotDto = z.infer<typeof ConsoleSlotDto>;

export const ConsoleReportDto = z.object({
  id: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().nullable(),
  status: z.enum(REPORT_STATES),
  createdAt: z.date(),
  reporter: z.object({ id: z.uuid(), displayName: z.string() }),
  reported: z.object({ id: z.uuid(), displayName: z.string(), hidden: z.boolean() }),
});
export type ConsoleReportDto = z.infer<typeof ConsoleReportDto>;

export const NetworkConsoleDto = z.object({
  settings: NetworkSettingsDto,
  stats: z.object({
    optedIn: z.int().min(0),
    connections: z.int().min(0),
    meetings: z.int().min(0),
  }),
  locations: z.array(ConsoleLocationDto),
  slots: z.array(ConsoleSlotDto),
  reports: z.array(ConsoleReportDto),
  hidden: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
});
export type NetworkConsoleDto = z.infer<typeof NetworkConsoleDto>;
