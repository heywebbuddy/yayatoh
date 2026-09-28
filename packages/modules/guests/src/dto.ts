import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { AGE_CLASSES, GUEST_KINDS, GUEST_SOURCES, HISTORY_ACTIONS } from './schema.ts';

/**
 * A guest as the host's console shows it (organizer roles with `attendees:read`). The sealed
 * answers are opened for this allowlist only; no public or guest-facing DTO carries them.
 */
export const GuestDto = z.object({
  id: z.uuid(),
  partyId: z.uuid(),
  kind: z.enum(GUEST_KINDS),
  hostGuestId: z.uuid().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  ageClass: z.enum(AGE_CLASSES),
  meal: z.string().nullable(),
  dietary: z.string().nullable(),
  accessibility: z.string().nullable(),
  address: z.string().nullable(),
  attendeeId: z.uuid().nullable(),
  isPrimary: z.boolean(),
});
export type GuestDto = z.infer<typeof GuestDto>;
export const guestSerializer = defineSerializer('guests.guest', GuestDto);

export const PartyDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  envelopeName: z.string().nullable(),
  side: z.string().nullable(),
  vip: z.boolean(),
  tags: z.array(z.string()),
  notes: z.string(),
  source: z.enum(GUEST_SOURCES),
  createdAt: z.date(),
});
export type PartyDto = z.infer<typeof PartyDto>;
export const partySerializer = defineSerializer('guests.party', PartyDto);

export const PartyWithGuestsDto = PartyDto.extend({ guests: z.array(GuestDto) });
export type PartyWithGuestsDto = z.infer<typeof PartyWithGuestsDto>;

export const GuestCountsDto = z.object({
  parties: z.number().int(),
  vipParties: z.number().int(),
  guests: z.number().int(),
  adults: z.number().int(),
  children: z.number().int(),
  infants: z.number().int(),
  plusOnesPending: z.number().int(),
});

export const GuestListDto = z.object({
  /** Across the whole event (filters don't change them). */
  counts: GuestCountsDto,
  /** Parties matching the filters. */
  total: z.number().int(),
  parties: z.array(PartyWithGuestsDto),
  /** Sides and tags in use at the event, for the filters. */
  sides: z.array(z.string()),
  tags: z.array(z.string()),
});
export type GuestListDto = z.infer<typeof GuestListDto>;

export const HistoryEntryDto = z.object({
  id: z.uuid(),
  partyId: z.uuid(),
  guestId: z.uuid().nullable(),
  action: z.enum(HISTORY_ACTIONS),
  source: z.enum(GUEST_SOURCES),
  actor: z.string(),
  fields: z.array(z.string()),
  detail: z.record(z.string(), z.union([z.string(), z.number()])),
  at: z.date(),
});
export type HistoryEntryDto = z.infer<typeof HistoryEntryDto>;
