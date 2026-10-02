import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ADMISSION_ITEM_KINDS, ELIGIBILITY_KINDS } from './schema.ts';

export const RegistrationTypeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.int(),
  capacity: z.int().nullable(),
  quantityHeld: z.int(),
  quantitySold: z.int(),
  eligibility: z.enum(ELIGIBILITY_KINDS),
  /** Console only: the code the organizer hands out. */
  accessCode: z.string().nullable(),
  emailDomains: z.array(z.string()),
  /** The type's lines (M3.10a): places waited for and places open offers hold. */
  waiting: z.int(),
  offered: z.int(),
});
export type RegistrationTypeDto = z.infer<typeof RegistrationTypeDto>;

export const AdmissionItemDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(ADMISSION_ITEM_KINDS),
  sortOrder: z.int(),
});
export type AdmissionItemDto = z.infer<typeof AdmissionItemDto>;

export const CellDto = z.object({
  id: z.uuid(),
  registrationTypeId: z.uuid(),
  admissionItemId: z.uuid(),
  ticketTypeId: z.uuid(),
  priceMinor: z.int(),
  allInMinor: z.int(),
  quantitySold: z.int(),
});
export type CellDto = z.infer<typeof CellDto>;

export const RegistrationSetupDto = z.object({
  eventId: z.uuid(),
  currency: z.string(),
  types: z.array(RegistrationTypeDto),
  items: z.array(AdmissionItemDto),
  cells: z.array(CellDto),
  /** The conference pack (P5-11): whether it is active for the event, how, and its quotas. */
  pack: z.object({
    active: z.boolean(),
    source: z.enum(['beta_free', 'purchase', 'override']).nullable(),
    quotas: z.record(z.string(), z.int()),
  }),
});
export type RegistrationSetupDto = z.infer<typeof RegistrationSetupDto>;
export const registrationSetupSerializer = defineSerializer('registration.setup', RegistrationSetupDto);

/**
 * What a buyer sees of a type at checkout (ADR 0014 allowlist): name, description and price range
 * only, plus whether it is full (then its waitlist is offered). Never capacity, counts, codes or
 * domains.
 */
export const PublicRegistrationTypeDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  minAllInMinor: z.int(),
  maxAllInMinor: z.int(),
  full: z.boolean(),
});
export type PublicRegistrationTypeDto = z.infer<typeof PublicRegistrationTypeDto>;

/** The items a chosen type offers, with their all-in prices for that type. */
export const PublicTypeItemDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(ADMISSION_ITEM_KINDS),
  allInMinor: z.int(),
});
export type PublicTypeItemDto = z.infer<typeof PublicTypeItemDto>;

export const PublicRegistrationDto = z.object({
  types: z.array(PublicRegistrationTypeDto),
  /** Items per type id (only for the types listed). */
  items: z.record(z.string(), z.array(PublicTypeItemDto)),
});
export type PublicRegistrationDto = z.infer<typeof PublicRegistrationDto>;
export const publicRegistrationSerializer = defineSerializer('registration.public', PublicRegistrationDto);
