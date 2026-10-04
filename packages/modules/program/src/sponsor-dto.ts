import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import {
  DELIVERABLE_OWNERS,
  DELIVERABLE_STATUSES,
  GRANT_SOURCES,
  GRANT_STATUSES,
  LOGO_PLACEMENTS,
} from './schema-sponsors.ts';

/** M5.4b: sponsor packages, grants, deliverables and lead licenses (allowlisted DTOs). */
export const AllowancesDto = z.object({
  compRegistrations: z.int(),
  exhibitorBadges: z.int(),
  leadLicenses: z.int(),
  logoPlacements: z.array(z.enum(LOGO_PLACEMENTS)),
  sessionSlots: z.int(),
});
export type AllowancesDto = z.infer<typeof AllowancesDto>;

export const DeliverableTemplateDto = z.object({
  title: z.string(),
  owner: z.enum(DELIVERABLE_OWNERS),
  daysBefore: z.int(),
});
export type DeliverableTemplateDto = z.infer<typeof DeliverableTemplateDto>;

/** A tier with its package terms (`terms` null: the organizer has not set any yet). */
export const SponsorPackageDto = z.object({
  tierId: z.uuid(),
  name: z.string(),
  position: z.int(),
  terms: z
    .object({
      description: z.string(),
      priceMinor: z.int().nullable(),
      currency: z.string(),
      quantity: z.int().nullable(),
      onSale: z.boolean(),
      allowances: AllowancesDto,
      deliverables: z.array(DeliverableTemplateDto),
    })
    .nullable(),
  /** Active grants, and places left (null: no limit). */
  holders: z.int(),
  left: z.int().nullable(),
});
export type SponsorPackageDto = z.infer<typeof SponsorPackageDto>;

export const GrantDto = z.object({
  id: z.uuid(),
  tierId: z.uuid(),
  packageName: z.string(),
  status: z.enum(GRANT_STATUSES),
  source: z.enum(GRANT_SOURCES),
  priceMinor: z.int(),
  currency: z.string(),
  allowances: AllowancesDto,
  activatedAt: z.date().nullable(),
  note: z.string().nullable(),
  compCode: z.string().nullable(),
});
export type GrantDto = z.infer<typeof GrantDto>;

export const DeliverableDto = z.object({
  id: z.uuid(),
  sponsorId: z.uuid(),
  sponsorName: z.string(),
  title: z.string(),
  owner: z.enum(DELIVERABLE_OWNERS),
  ownerName: z.string().nullable(),
  dueAt: z.date(),
  /** `YYYY-MM-DD` in the event's time zone (due by the end of that day). */
  dueDate: z.string(),
  status: z.enum(DELIVERABLE_STATUSES),
  completedAt: z.date().nullable(),
  completedBy: z.enum(['organizer', 'sponsor']).nullable(),
  overdue: z.boolean(),
  fromPackage: z.boolean(),
});
export type DeliverableDto = z.infer<typeof DeliverableDto>;

export const SponsorContactDto = z.object({
  id: z.uuid(),
  email: z.string(),
  status: z.enum(['pending', 'active', 'revoked']),
  invitedAt: z.date(),
  lastSignInAt: z.date().nullable(),
});
export type SponsorContactDto = z.infer<typeof SponsorContactDto>;

export const SponsorshipAdminDto = z.object({
  timezone: z.string(),
  currency: z.string(),
  packages: z.array(SponsorPackageDto),
  sponsors: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      tierId: z.uuid(),
      tierName: z.string(),
      exhibitorId: z.uuid().nullable(),
      exhibitorName: z.string().nullable(),
      grant: GrantDto.nullable(),
      /** A purchase waiting for payment (until its hold lapses). */
      pendingUntil: z.date().nullable(),
      contacts: z.array(SponsorContactDto),
      sessions: z.array(z.object({ id: z.uuid(), title: z.string() })),
      deliverables: z.object({ open: z.int(), done: z.int(), overdue: z.int() }),
    }),
  ),
  exhibitors: z.array(z.object({ id: z.uuid(), name: z.string() })),
  sessions: z.array(z.object({ id: z.uuid(), title: z.string(), sponsorId: z.uuid().nullable() })),
});
export type SponsorshipAdminDto = z.infer<typeof SponsorshipAdminDto>;

export const DeliverablesDto = z.object({
  timezone: z.string(),
  sponsors: z.array(z.object({ id: z.uuid(), name: z.string() })),
  deliverables: z.array(DeliverableDto),
  /** The overdue ones, most overdue first. */
  overdue: z.array(DeliverableDto),
});
export type DeliverablesDto = z.infer<typeof DeliverablesDto>;

/** What a signed-in sponsor contact sees (P5-7: only their own sponsor and package). */
export const SponsorPortalDto = z.object({
  email: z.string(),
  event: z.object({ name: z.string(), timezone: z.string(), startsAt: z.date(), endsAt: z.date() }),
  sponsor: z.object({ name: z.string(), tierName: z.string(), exhibitorName: z.string().nullable() }),
  grant: z
    .object({
      packageName: z.string(),
      source: z.enum(GRANT_SOURCES),
      priceMinor: z.int(),
      currency: z.string(),
      allowances: AllowancesDto,
      activatedAt: z.date().nullable(),
      compCode: z.string().nullable(),
      sessions: z.array(z.object({ title: z.string(), startsAt: z.date(), endsAt: z.date() })),
    })
    .nullable(),
  pendingUntil: z.date().nullable(),
  /** Packages this sponsor can buy now (none while one is active or waiting for payment). */
  forSale: z.array(
    z.object({
      tierId: z.uuid(),
      name: z.string(),
      description: z.string(),
      priceMinor: z.int(),
      currency: z.string(),
      allowances: AllowancesDto,
      soldOut: z.boolean(),
    }),
  ),
  deliverables: z.array(DeliverableDto.omit({ sponsorId: true, sponsorName: true, completedBy: true })),
});
export type SponsorPortalDto = z.infer<typeof SponsorPortalDto>;
export const sponsorPortalSerializer = defineSerializer('program.sponsorPortal', SponsorPortalDto);

/** An exhibitor's lead licenses (P5-4), for the organizer and the exhibitor portal. */
export const LeadLicenseUseDto = z.object({
  included: z.int(),
  fromPackages: z.int(),
  purchased: z.int(),
  allowance: z.int(),
  used: z.int(),
  left: z.int(),
});
export type LeadLicenseUseDto = z.infer<typeof LeadLicenseUseDto>;

export const LeadLicenseSettingsDto = z.object({
  includedLeadLicenses: z.int(),
  leadLicensePriceMinor: z.int().nullable(),
  currency: z.string(),
});
export type LeadLicenseSettingsDto = z.infer<typeof LeadLicenseSettingsDto>;

export const LeadLicensesAdminDto = z.object({
  settings: LeadLicenseSettingsDto,
  exhibitors: z.array(
    z.object({
      exhibitorId: z.uuid(),
      name: z.string(),
      licenses: LeadLicenseUseDto,
      staffBadges: z.object({ base: z.int(), fromPackages: z.int() }),
    }),
  ),
});
export type LeadLicensesAdminDto = z.infer<typeof LeadLicensesAdminDto>;

export const PortalLeadLicensesDto = z.object({
  role: z.enum(['exhibitor_admin', 'exhibitor_staff']),
  licenses: LeadLicenseUseDto,
  /** Who holds a seat (and, for admins, everyone who could). */
  people: z.array(
    z.object({
      accountId: z.uuid(),
      email: z.string(),
      role: z.enum(['exhibitor_admin', 'exhibitor_staff']),
      licensed: z.boolean(),
    }),
  ),
  /** Extra licenses for sale (null: the organizer does not sell them). */
  price: z.object({ unitMinor: z.int(), currency: z.string() }).nullable(),
  /** A purchase waiting for payment (until its hold lapses). */
  pendingUntil: z.date().nullable(),
  mine: z.boolean(),
});
export type PortalLeadLicensesDto = z.infer<typeof PortalLeadLicensesDto>;
export const portalLeadLicensesSerializer = defineSerializer(
  'program.portalLeadLicenses',
  PortalLeadLicensesDto,
);

/** What an add-on order sells (orders builds the order from it). */
export const AddonOfferDto = z.object({
  refId: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  quantity: z.int(),
  unitFaceMinor: z.int(),
  currency: z.string(),
  buyer: z.object({ email: z.string(), name: z.string() }),
});
export type AddonOfferDto = z.infer<typeof AddonOfferDto>;
