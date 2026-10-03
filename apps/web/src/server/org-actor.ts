import 'server-only';
import { type Ctx, type CtxInit, createCtx } from '@yayatoh/kernel';
import { type AgencyAccess, agencyAccess, type ConsoleRole, memberRole } from '@yayatoh/tenancy';
import type { Session } from './session.ts';

export interface OrgActor {
  readonly ctx: Ctx;
  readonly role: ConsoleRole;
  /** The live agency grant the user acts through (M6.7a), or null for a member. */
  readonly agency: AgencyAccess | null;
}

/**
 * A signed-in user's context in an org, read fresh on every request: their membership, or (M6.7a)
 * the live agency grant they act through, which then rides on the context (`viaAgency`) so the
 * authorizer re-checks it and every audit row names it. Staff acting as a member (M1.2e) never
 * act through an agency. Null when the user has neither (callers answer 404).
 */
export async function orgActor(
  orgId: string,
  session: Session,
  extra: Omit<CtxInit, 'orgId' | 'actor' | 'impersonatedBy' | 'viaAgency'> = {},
): Promise<OrgActor | null> {
  const imp = session.impersonation;
  if (imp && imp.orgId !== orgId) return null;
  const ctx = createCtx({
    stepUpAt: session.stepUpAt,
    ...extra,
    orgId,
    actor: { type: 'user', userId: session.userId },
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  const role = await memberRole(ctx);
  if (role) return { ctx, role, agency: null };
  if (imp) return null;
  const agency = await agencyAccess(ctx);
  if (!agency) return null;
  return {
    ctx: createCtx({
      ...ctx,
      viaAgency: { grantId: agency.grantId, agencyOrgId: agency.agencyOrgId },
    }),
    role: agency.consoleRole,
    agency,
  };
}
