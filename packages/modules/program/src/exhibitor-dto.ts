import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { BOOTH_WARNING_KINDS } from './domain/exhibitors.ts';
import { LinkDto } from './dto.ts';
import { EXHIBITOR_MEMBER_ROLES, EXHIBITOR_MEMBER_STATUSES } from './schema.ts';

/** The portal roles (decision P5-7); M5.4a signs in exhibitor admins and staff. */
export const PORTAL_ROLES = ['speaker', 'exhibitor_admin', 'exhibitor_staff', 'sponsor_contact'] as const;

/**
 * Who is signed in to a portal (the contract M5.3a owns: `requirePortalPrincipal()`): one event
 * role at one event, and the row it acts for (`subjectId`: the exhibitor for exhibitor roles).
 */
export const PortalPrincipal = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  eventRoleAssignmentId: z.uuid(),
  role: z.enum(PORTAL_ROLES),
  subjectId: z.uuid(),
});
export type PortalPrincipal = z.infer<typeof PortalPrincipal>;

export const ExhibitorSettingsDto = z.object({
  defaultStaffAllowance: z.int(),
  approvalRequired: z.boolean(),
});
export type ExhibitorSettingsDto = z.infer<typeof ExhibitorSettingsDto>;

/** What an exhibitor admin may change (and what an approval applies). */
export const ProfileProposalDto = z.object({
  name: z.string(),
  description: z.string(),
  websiteUrl: z.string().nullable(),
  links: z.array(LinkDto),
  categories: z.array(z.string()),
});
export type ProfileProposalDto = z.infer<typeof ProfileProposalDto>;

export const ExhibitorMemberDto = z.object({
  id: z.uuid(),
  exhibitorId: z.uuid(),
  email: z.string(),
  role: z.enum(EXHIBITOR_MEMBER_ROLES),
  status: z.enum(EXHIBITOR_MEMBER_STATUSES),
  invitedAt: z.date(),
  acceptedAt: z.date().nullable(),
  expiresAt: z.date(),
});
export type ExhibitorMemberDto = z.infer<typeof ExhibitorMemberDto>;

export const AllowanceDto = z.object({ allowance: z.int(), used: z.int(), left: z.int() });

export const PendingChangeDto = z.object({
  id: z.uuid(),
  proposed: ProfileProposalDto,
  submittedAt: z.date(),
});

/** One exhibitor on the organizer's portal page. */
export const ExhibitorPortalRowDto = z.object({
  exhibitorId: z.uuid(),
  name: z.string(),
  listed: z.boolean(),
  categories: z.array(z.string()),
  links: z.array(LinkDto),
  /** The organizer's own allowance for this exhibitor; null = the event's default. */
  staffAllowance: z.int().nullable(),
  staff: AllowanceDto,
  members: z.array(ExhibitorMemberDto),
  pendingChange: PendingChangeDto.nullable(),
  /** The current profile, to diff a pending change against. */
  current: ProfileProposalDto,
});
export type ExhibitorPortalRowDto = z.infer<typeof ExhibitorPortalRowDto>;

export const ExhibitorPortalAdminDto = z.object({
  settings: ExhibitorSettingsDto,
  exhibitors: z.array(ExhibitorPortalRowDto),
});
export type ExhibitorPortalAdminDto = z.infer<typeof ExhibitorPortalAdminDto>;

export const InviteResultDto = z.object({
  member: ExhibitorMemberDto,
  exhibitorName: z.string(),
  eventName: z.string(),
});
export type InviteResultDto = z.infer<typeof InviteResultDto>;

/**
 * What a signed-in exhibitor admin or staff member sees (portal allowlist): their own exhibitor,
 * event and booths only; the staff list and allowance only for admins. Never another exhibitor,
 * never the organizer's settings beyond whether edits need approval.
 */
export const PortalExhibitorViewDto = z.object({
  role: z.enum(EXHIBITOR_MEMBER_ROLES),
  email: z.string(),
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
  }),
  exhibitor: ProfileProposalDto.extend({ id: z.uuid(), listed: z.boolean() }),
  approvalRequired: z.boolean(),
  pendingChange: ProfileProposalDto.nullable(),
  booths: z.array(
    z.object({
      number: z.string(),
      category: z.string().nullable(),
      width: z.int(),
      height: z.int(),
      primary: z.boolean(),
    }),
  ),
  /** Admins only (null for staff). */
  staff: z
    .object({
      allowance: AllowanceDto,
      members: z.array(ExhibitorMemberDto.omit({ exhibitorId: true })),
    })
    .nullable(),
});
export type PortalExhibitorViewDto = z.infer<typeof PortalExhibitorViewDto>;
export const portalExhibitorViewSerializer = defineSerializer(
  'program.portalExhibitorView',
  PortalExhibitorViewDto,
);

/* ---------------------------------------------------------------------------- booths ---- */

export const BoothDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  number: z.string(),
  category: z.string().nullable(),
  x: z.int(),
  y: z.int(),
  width: z.int(),
  height: z.int(),
  exhibitors: z.array(z.object({ exhibitorId: z.uuid(), isPrimary: z.boolean() })),
});
export type BoothDto = z.infer<typeof BoothDto>;

export const BoothWarningDto = z.object({
  kind: z.enum(BOOTH_WARNING_KINDS),
  boothId: z.uuid().nullable(),
  otherBoothId: z.uuid().nullable(),
  exhibitorId: z.uuid().nullable(),
});
export type BoothWarningDto = z.infer<typeof BoothWarningDto>;

export const BoothPlanDto = z.object({
  booths: z.array(BoothDto),
  warnings: z.array(BoothWarningDto),
});
export type BoothPlanDto = z.infer<typeof BoothPlanDto>;

/**
 * The public exhibitor map (allowlist): booth numbers, sizes, positions and categories, and the
 * listed exhibitors' names, descriptions and categories. Never staff, contacts, allowances,
 * unlisted exhibitors or pending changes. Logos come from media's public program images.
 */
export const PublicExhibitorMapDto = z.object({
  width: z.int(),
  height: z.int(),
  booths: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      category: z.string().nullable(),
      x: z.int(),
      y: z.int(),
      width: z.int(),
      height: z.int(),
      exhibitorIds: z.array(z.uuid()),
    }),
  ),
  exhibitors: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      description: z.string(),
      categories: z.array(z.string()),
      boothNumbers: z.array(z.string()),
    }),
  ),
});
export type PublicExhibitorMapDto = z.infer<typeof PublicExhibitorMapDto>;
export const publicExhibitorMapSerializer = defineSerializer(
  'program.publicExhibitorMap',
  PublicExhibitorMapDto,
);
