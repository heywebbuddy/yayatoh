import { DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, tenantCommand } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { organizationBrandTx } from '../queries.ts';
import { memberships } from '../schema.ts';

/**
 * Staff impersonation in the org's own record (M1.2e, decision D14 "reason + org notice"). The
 * global impersonation record lives in packages/auth; these commands write the tenant audit rows
 * at start and end (the org's Activity log shows them) and tell the org's owners at once. Only
 * platform (system) actors may run them: the staff console at start, the app host or the worker at
 * the end.
 */
export const IMPERSONATION_STARTED = 'tenancy.impersonation_started';

export const StartImpersonationInput = z.object({
  impersonationId: z.uuid(),
  userId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.date(),
  /** Shown to the owners (the member's display name). */
  memberName: z.string().max(200),
});

const ImpersonationOutput = z.object({ impersonationId: z.uuid(), userId: z.uuid(), role: z.string() });

export const startImpersonationCommand = tenantCommand({
  name: 'tenancy.startImpersonation',
  input: StartImpersonationInput,
  output: ImpersonationOutput,
  entitlement: null,
  permission: 'platform:impersonate',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [member] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, input.userId)));
    if (!member) throw new DomainError('not_found', 'Not a member of this organization');
    emit({
      type: IMPERSONATION_STARTED,
      version: 1,
      aggregateType: 'impersonation',
      aggregateId: input.impersonationId,
      payload: {
        orgId,
        impersonationId: input.impersonationId,
        userId: input.userId,
        memberName: input.memberName,
        reason: input.reason,
        expiresAt: input.expiresAt.toISOString(),
      },
    });
    return { impersonationId: input.impersonationId, userId: input.userId, role: member.role };
  },
  audit: (input, r) => ({
    action: 'impersonation.start',
    targetType: 'membership',
    targetId: input.userId,
    data: { impersonationId: input.impersonationId, role: r.role, reasonText: input.reason },
  }),
});

export const EndImpersonationInput = z.object({
  impersonationId: z.uuid(),
  userId: z.uuid(),
  how: z.enum(['ended', 'expired', 'revoked']),
});

export const endImpersonationCommand = tenantCommand({
  name: 'tenancy.endImpersonation',
  input: EndImpersonationInput,
  output: z.object({ impersonationId: z.uuid() }),
  entitlement: null,
  permission: 'platform:impersonate',
  handler: async ({ input }) => ({ impersonationId: input.impersonationId }),
  audit: (input) => ({
    action: 'impersonation.end',
    targetType: 'membership',
    targetId: input.userId,
    data: { impersonationId: input.impersonationId, reason: input.how },
  }),
});

const StartedPayload = z.object({
  orgId: z.uuid(),
  impersonationId: z.uuid(),
  memberName: z.string(),
  reason: z.string(),
  expiresAt: z.string(),
});

/**
 * The org notice (D14): the owners hear at once that Yayatoh staff are acting as a member, why,
 * and until when (in-app + email, transactional, `tenancy.staff-access`).
 */
export function impersonationNotice(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'tenancy.impersonation-notice',
    events: [`${IMPERSONATION_STARTED}@1`],
    handle: async (tx, event) => {
      const p = StartedPayload.parse(event.payload);
      const org = await organizationBrandTx(tx, p.orgId);
      if (!org) return;
      await deps.notifier.notifyMembers(tx, {
        kind: 'tenancy.staff-access',
        params: {
          url: `${deps.appOrigin}/o/${org.slug}/activity`,
          member: p.memberName,
          reason: p.reason,
          until: p.expiresAt,
          timeZone: org.timezone,
        },
        dedupeKey: `staff-access:${p.impersonationId}`,
        href: '/activity',
      });
    },
  });
}
