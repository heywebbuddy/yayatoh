import { effectiveModulesTx } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { type EventDto, eventRoleGrantsTx, findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { isProfileKey, type ProfileKey } from '@yayatoh/platform';
import { eventRoleCan, memberRoleTx, type OrgRole, roleCan } from '@yayatoh/tenancy';
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
 * The caller's Command Center role for one event: their membership (under the org's RLS), their
 * live event roles, the org's modules and the event's profile. Only signed-in members have one.
 */
export async function callerScopeTx(tx: TenantTx, ctx: Ctx, eventId: string): Promise<CallerScope> {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'The Command Center is for members');
  const userId = ctx.actor.userId;
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const orgRole = await memberRoleTx(tx, userId);
  const eventRoles = (await eventRoleGrantsTx(tx, eventId, userId, ctx.now)).map((g) => g.role);
  const role = commandCenterRole(orgRole, eventRoles);
  if (!orgRole || !role) throw new DomainError('forbidden', 'Not a member');
  const modules = await effectiveModulesTx(tx);
  return {
    event,
    userId,
    orgRole,
    eventRoles,
    role,
    modules,
    profile: profileOf(event),
    canWrite: roleCan(orgRole as OrgRole, 'events:write') || eventRoleCan(eventRoles, 'events:write'),
  };
}

/** The caller's org-level Command Center role (the multi-event overview: no event roles). */
export async function orgScopeTx(
  tx: TenantTx,
  ctx: Ctx,
): Promise<{ role: CcRole; orgRole: string; modules: Set<string> }> {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'The Command Center is for members');
  const orgRole = await memberRoleTx(tx, ctx.actor.userId);
  const role = commandCenterRole(orgRole, []);
  if (!orgRole || !role) throw new DomainError('forbidden', 'Not a member');
  return { role, orgRole, modules: await effectiveModulesTx(tx) };
}

export const profileOf = (event: Pick<EventDto, 'profile'>): ProfileKey =>
  isProfileKey(event.profile) ? event.profile : 'other';
