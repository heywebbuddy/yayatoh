import { withTenant } from '@yayatoh/db';
import type { CommandPorts, Ctx } from '@yayatoh/kernel';
import { and, eq } from 'drizzle-orm';
import { apiKeyScopes } from './commands/api-keys.ts';
import { eventRoleCan, type OrgRole, roleCan } from './domain/permissions.ts';
import { memberships } from './schema.ts';

/** The actor's role in the context org, or null. Read under the tenant's RLS. */
export async function memberRole(ctx: Ctx): Promise<OrgRole | null> {
  if (ctx.actor.type !== 'user' || !ctx.orgId) return null;
  const userId = ctx.actor.userId;
  const orgId = ctx.orgId;
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))),
  );
  return (row?.role as OrgRole | undefined) ?? null;
}

/** Event roles of the actor for one event; implemented by the events module (a port: tier 1 can't read tier 2). */
export type EventRoleResolver = (ctx: Ctx, eventId: string) => Promise<readonly string[]>;

/**
 * Permissions an API key scope carries beyond its own name. M4.2a split `seating:write` out of
 * `events:write` for member roles; a key's `events:write` scope keeps seating (the /v1 bulk seat
 * assignment), so no existing key loses a power (/v1 is additive only).
 */
const SCOPE_FOR: Readonly<Record<string, string>> = { 'seating:write': 'events:write' };

const eventIdOf = (input: unknown): string | null => {
  const id = (input as { eventId?: unknown } | null)?.eventId;
  return typeof id === 'string' ? id : null;
};

/**
 * Org authorizer. Platform permissions (`platform:*`) need a signed-in user for org creation
 * or a system actor; everything else needs a membership whose role grants the permission, or,
 * for a command about one event (`input.eventId`), a member's event-scoped role that grants it.
 */
export function createOrgAuthorizer(
  deps: { eventRoles?: EventRoleResolver } = {},
): CommandPorts<unknown>['authorizer'] {
  return {
    async can(ctx, permission, input) {
      if (permission === 'platform:org.create')
        return ctx.actor.type === 'user' || ctx.actor.type === 'system';
      // Accepting is checked in the handler (token + verified email match), not by an org role.
      if (permission === 'invitation:accept') return ctx.actor.type === 'user';
      // Public commands (checkout) are open to anyone; the command itself enforces what may be bought.
      if (permission.startsWith('public:')) return true;
      if (permission.startsWith('platform:')) return ctx.actor.type === 'system';
      if (ctx.actor.type === 'system') return true;
      // An org API key may do exactly what its live scopes list, in its own org only.
      if (ctx.actor.type === 'api_key') {
        const scopes = await apiKeyScopes(ctx, ctx.actor.keyId);
        return scopes.includes(permission) || scopes.includes(SCOPE_FOR[permission] ?? permission);
      }
      const role = await memberRole(ctx);
      if (role === null) return false;
      if (roleCan(role, permission)) return true;
      const eventId = eventIdOf(input);
      if (!eventId || !deps.eventRoles) return false;
      return eventRoleCan(await deps.eventRoles(ctx, eventId), permission);
    },
  };
}

/** The org-role-only authorizer (no event-scoped roles). */
export const orgAuthorizer = createOrgAuthorizer();
