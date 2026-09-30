import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ATTENDANCE_MODES, EVENT_CATEGORIES } from './domain/categories.ts';
import { ANNOUNCEMENT_AUDIENCES, SECTION_KINDS, SHORT_LINK_KINDS } from './domain/content-kinds.ts';
import { SectionBody } from './domain/sections.ts';

export const EventDetailsDto = z.object({
  eventId: z.uuid(),
  venueId: z.uuid().nullable(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  category: z.enum(EVENT_CATEGORIES).nullable(),
  attendanceMode: z.enum(ATTENDANCE_MODES),
  tags: z.array(z.string()),
});
export type EventDetailsDto = z.infer<typeof EventDetailsDto>;

export const SetEventDetailsInput = z.object({
  eventId: z.uuid(),
  venueId: z.uuid().nullable().optional(),
  category: z.enum(EVENT_CATEGORIES).nullable().optional(),
  attendanceMode: z.enum(ATTENDANCE_MODES).optional(),
  tags: z.array(z.string().max(200)).max(50).optional(),
});

export const EventSectionDto = z.intersection(
  z.object({
    id: z.uuid(),
    eventId: z.uuid(),
    kind: z.enum(SECTION_KINDS),
    title: z.string(),
    position: z.number().int(),
    visible: z.boolean(),
  }),
  SectionBody,
);
export type EventSectionDto = z.infer<typeof EventSectionDto>;

export const PublicSectionDto = z.intersection(z.object({ id: z.uuid(), title: z.string() }), SectionBody);
export type PublicSectionDto = z.infer<typeof PublicSectionDto>;

export const AnnouncementDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  title: z.string(),
  body: z.string(),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  pinned: z.boolean(),
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type AnnouncementDto = z.infer<typeof AnnouncementDto>;

export const PublicAnnouncementDto = AnnouncementDto.pick({
  id: true,
  title: true,
  body: true,
  audience: true,
  pinned: true,
  publishedAt: true,
});
export type PublicAnnouncementDto = z.infer<typeof PublicAnnouncementDto>;

/** Everything the public event page may show from M1.4d content. No private info, no join link. */
export const PublicEventContentDto = z.object({
  sections: z.array(PublicSectionDto),
  announcements: z.array(PublicAnnouncementDto),
});
export type PublicEventContentDto = z.infer<typeof PublicEventContentDto>;
export const publicEventContentSerializer = defineSerializer(
  'events.publicEventContent',
  PublicEventContentDto,
);

export const PrivateInfoDto = z.object({
  eventId: z.uuid(),
  body: z.string(),
  joinUrl: z.string().nullable(),
  joinOpensMinutes: z.number().int(),
  updatedAt: z.date().nullable(),
});
export type PrivateInfoDto = z.infer<typeof PrivateInfoDto>;

/** What a verified ticket holder sees (the attendee portal). */
export const HolderEventContentDto = z.object({
  privateInfo: z.string(),
  attendanceMode: z.enum(ATTENDANCE_MODES),
  /** Present only inside the join window. */
  joinUrl: z.string().nullable(),
  /** When the join link appears (null if there is none, or it's already shown). */
  joinOpensAt: z.date().nullable(),
  joinClosed: z.boolean(),
  announcements: z.array(PublicAnnouncementDto),
});
export type HolderEventContentDto = z.infer<typeof HolderEventContentDto>;
export const holderEventContentSerializer = defineSerializer(
  'events.holderEventContent',
  HolderEventContentDto,
);

export const AccessCodeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  code: z.string(),
  label: z.string().nullable(),
  unlocksEvent: z.boolean(),
  ticketTypeIds: z.array(z.uuid()),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: z.date().nullable(),
  active: z.boolean(),
  createdAt: z.date(),
});
export type AccessCodeDto = z.infer<typeof AccessCodeDto>;

/** What a successful unlock grants (server-side; the code id goes into a signed cookie). */
export const AccessGrantDto = z.object({
  codeId: z.uuid(),
  unlocksEvent: z.boolean(),
  ticketTypeIds: z.array(z.uuid()),
  expiresAt: z.date().nullable(),
});
export type AccessGrantDto = z.infer<typeof AccessGrantDto>;

export const ShortLinkDto = z.object({
  code: z.string(),
  kind: z.enum(SHORT_LINK_KINDS),
});
export type ShortLinkDto = z.infer<typeof ShortLinkDto>;
