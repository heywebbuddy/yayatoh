import {
  CurrencyCode,
  defineSerializer,
  IanaTimezone,
  LOCALES,
  partialNoDefaults,
  Slug,
} from '@yayatoh/contracts';
import { z } from 'zod';
import { ORG_KINDS, ORG_ROLES, ORG_STATUSES } from './schema.ts';

export const OrganizationDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(ORG_KINDS),
  status: z.enum(ORG_STATUSES),
  defaultProfile: z.string(),
  defaultLocale: z.string(),
  timezone: z.string(),
  country: z.string(),
  currency: z.string(),
  brandColor: z.string().nullable(),
});
export type OrganizationDto = z.infer<typeof OrganizationDto>;
export const organizationSerializer = defineSerializer('tenancy.organization', OrganizationDto);

export const MembershipDto = z.object({
  orgId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(ORG_ROLES),
  createdAt: z.date(),
});
export type MembershipDto = z.infer<typeof MembershipDto>;
export const membershipSerializer = defineSerializer('tenancy.membership', MembershipDto);

/** "My organizations" for the org switcher: allowlisted, from tenancy.user_memberships(). */
export const MyOrganizationDto = z.object({
  orgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: z.enum(ORG_ROLES),
});
export type MyOrganizationDto = z.infer<typeof MyOrganizationDto>;

/**
 * Org slugs that would collide with platform routes or pages (`/legal/platform/…`, subdomains
 * like `admin.`). New orgs can't take them; existing orgs are unaffected.
 */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'claim',
  'events',
  'help',
  'invite',
  'legal',
  'my-tickets',
  'o',
  'orders',
  'platform',
  'scan',
  'sign-in',
  'signup',
  'status',
  'support',
  'www',
  'yayatoh',
]);

export const CreateOrganizationInput = z.object({
  slug: Slug.refine((s) => !RESERVED_ORG_SLUGS.has(s), 'This address is reserved'),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(ORG_KINDS).exclude(['platform']).default('organizer'),
  defaultProfile: z
    .enum(['wedding', 'gala', 'concert', 'conference', 'community', 'agency', 'other'])
    .default('other'),
  defaultLocale: z.enum(LOCALES).default('en'),
  timezone: IanaTimezone.default('America/New_York'),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('US'),
  currency: CurrencyCode.default('USD'),
});
export type CreateOrganizationInput = z.input<typeof CreateOrganizationInput>;

export const UpdateOrganizationInput = partialNoDefaults(
  CreateOrganizationInput.pick({
    name: true,
    defaultProfile: true,
    defaultLocale: true,
    timezone: true,
    country: true,
    currency: true,
  }).extend({
    /** Brand kit accent colour, #rrggbb (lower-cased), or null to use the default. */
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((c) => c.toLowerCase())
      .nullable(),
  }),
);

export const AddMemberInput = z.object({ userId: z.uuid(), role: z.enum(ORG_ROLES) });
export const ChangeMemberRoleInput = AddMemberInput;
export const RemoveMemberInput = z.object({ userId: z.uuid() });

export const InvitationDto = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  expiresAt: z.date(),
  acceptedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type InvitationDto = z.infer<typeof InvitationDto>;
