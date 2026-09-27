import { CurrencyCode, defineSerializer, IanaTimezone, LOCALES, Slug } from '@yayatoh/contracts';
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

export const CreateOrganizationInput = z.object({
  slug: Slug,
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

export const UpdateOrganizationInput = CreateOrganizationInput.pick({
  name: true,
  defaultProfile: true,
  defaultLocale: true,
  timezone: true,
}).partial();

export const AddMemberInput = z.object({ userId: z.uuid(), role: z.enum(ORG_ROLES) });
export const ChangeMemberRoleInput = AddMemberInput;
export const RemoveMemberInput = z.object({ userId: z.uuid() });
