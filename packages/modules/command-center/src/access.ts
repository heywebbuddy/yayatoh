import { effectiveModulesTx } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { type EventDto, eventRoleGrantsTx, findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { isProfileKey, type ProfileKey } from '@yayatoh/platform';
import { agencyAccessTx, type ConsoleRole, eventRoleCan, memberRoleTx, roleCan } from '@yayatoh/tenancy';
import { type CcRole, commandCenterRole } from './domain/roles.ts';
import type { WidgetScope } from './domain/widgets.ts';

/** Who is looking at an event's Command Center, decided inside the tenant transaction. */
export interface CallerScope extends WidgetScope {
  readonly event: EventDto;
  readonly userId: string;
  readonly orgRole: string;
  readonly eventRoles: readonly string[];
  /** The member may write to the event (org role or event role): the mode override. */
  readonly canWrite: boolean;
}

/**
 * The caller's org role: their membership, or (M6.7a) the live agency grant the context acts
 * through. `orgRole` is the role the Command Center maps (the grant's role for an agency), and
 * `consoleRole` the one permissions are read from (the agency console role, finance-gated).
 */
async function callerRoleTx(
  tx: TenantTx,
  ctx: Ctx,
  userId: string,
): Promise<{ orgRole: string; consoleRole: ConsoleRole } | null> {
  const member = await memberRoleTx(tx, userId);
  if (member) return { orgRole: member, consoleRole: member };
  if (!ctx.viaAgency) return null;
  const agency = await agencyAccessTx(tx);
  if (!agency || agency.grantId !== ctx.viaAgency.grantId) return null;
  return { orgRole: agency.role, consoleRole: agency.consoleRole };
}

/**
 * The caller's Command Center role for one event: their membership (under the org's RLS), their
 * live event roles, the org's modules and the event's profile. Only signed-in members have one.
 */
export async function callerScopeTx(tx: TenantTx, ctx: Ctx, eventId: string): Promise<CallerScope> {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'The Command Center is for members');
  const userId = ctx.actor.userId;
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const caller = await callerRoleTx(tx, ctx, userId);
  const orgRole = caller?.orgRole ?? null;
  // Event roles never apply to agency access.
  const eventRoles =
    caller && caller.orgRole === caller.consoleRole
      ? (await eventRoleGrantsTx(tx, eventId, userId, ctx.now)).map((g) => g.role)
      : [];
  const role = commandCenterRole(orgRole, eventRoles);
  if (!caller || !orgRole || !role) throw new DomainError('forbidden', 'Not a member');
  const modules = await effectiveModulesTx(tx);
  return {
    event,
    userId,
    orgRole,
    eventRoles,
    role,
    modules,
    profile: profileOf(event),
    canWrite: roleCan(caller.consoleRole, 'events:write') || eventRoleCan(eventRoles, 'events:write'),
  };
}

/** The caller's org-level Command Center role (the multi-event overview: no event roles). */
export async function orgScopeTx(
  tx: TenantTx,
  ctx: Ctx,
): Promise<{ role: CcRole; orgRole: string; modules: Set<string> }> {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'The Command Center is for members');
  const caller = await callerRoleTx(tx, ctx, ctx.actor.userId);
  const role = commandCenterRole(caller?.orgRole ?? null, []);
  if (!caller || !role) throw new DomainError('forbidden', 'Not a member');
  return { role, orgRole: caller.orgRole, modules: await effectiveModulesTx(tx) };
}

export const profileOf = (event: Pick<EventDto, 'profile'>): ProfileKey =>
  isProfileKey(event.profile) ? event.profile : 'other';
