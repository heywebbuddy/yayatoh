import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { organizations } from '../schema.ts';

/**
 * The org's two-step verification policy: whether its owners, admins and finance members must
 * use an authenticator app (decision D14, on by default). Switched off, they are no longer sent
 * to set one up before the console opens and may turn their own off (account security). Anyone
 * who keeps theirs on still answers it at sign-in and when confirming it's them.
 */
export const TwoFactorPolicyDto = z.object({ required: z.boolean() });
export type TwoFactorPolicyDto = z.infer<typeof TwoFactorPolicyDto>;

async function setPolicy(
  tx: TenantTx,
  orgId: string,
  required: boolean,
  now: Date,
): Promise<{ required: boolean; changed: boolean }> {
  const [org] = await tx
    .select({ required: organizations.requireTwoFactor })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update');
  if (!org) throw new DomainError('not_found', 'Organization not found');
  if (org.required === required) return { required, changed: false };
  await tx
    .update(organizations)
    .set({ requireTwoFactor: required, updatedAt: now })
    .where(eq(organizations.id, orgId));
  return { required, changed: true };
}

export const twoFactorPolicyQuery = tenantQuery({
  name: 'tenancy.twoFactorPolicy',
  input: z.object({}),
  output: TwoFactorPolicyDto,
  entitlement: null,
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    const [org] = await tx
      .select({ required: organizations.requireTwoFactor })
      .from(organizations)
      .where(eq(organizations.id, requireOrg(ctx)));
    if (!org) throw new DomainError('not_found', 'Organization not found');
    return { required: org.required };
  },
});

/** The org's owners and admins switch the requirement on or off (a sensitive change: step-up). */
export const setTwoFactorPolicyCommand = tenantCommand({
  name: 'tenancy.setTwoFactorPolicy',
  input: z.object({ required: z.boolean() }),
  output: z.object({ required: z.boolean(), changed: z.boolean() }),
  entitlement: null,
  permission: 'org:update',
  stepUp: true,
  handler: ({ input, ctx, tx }) => setPolicy(tx, requireOrg(ctx), input.required, ctx.now),
  audit: (input, r) => ({
    action: 'org.two_factor_policy',
    targetType: 'organization',
    targetId: null,
    data: { required: input.required, changed: r?.changed ?? false },
  }),
});

/**
 * Platform staff switch an org's requirement on or off (the admin console), with a reason kept
 * in the org's audit log (support: an organizer locked out, a shared test account).
 */
export const staffSetTwoFactorPolicyCommand = tenantCommand({
  name: 'tenancy.staffSetTwoFactorPolicy',
  input: z.object({ required: z.boolean(), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ required: z.boolean(), changed: z.boolean() }),
  entitlement: null,
  permission: 'platform:org.security',
  handler: ({ input, ctx, tx }) => setPolicy(tx, requireOrg(ctx), input.required, ctx.now),
  audit: (input, r) => ({
    action: 'org.two_factor_policy',
    targetType: 'organization',
    targetId: null,
    data: { required: input.required, changed: r?.changed ?? false, reason: input.reason, by: 'staff' },
  }),
});
