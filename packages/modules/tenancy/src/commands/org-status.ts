import type { TenantTx } from '@yayatoh/db';
import { actorId, type CommandPorts, DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { nextOrgStatus, type OrgStatus, orgWriteRefusal } from '../domain/org-status.ts';
import type { OrgRole } from '../domain/permissions.ts';
import { organizationBrandTx } from '../queries.ts';
import { memberships, ORG_STATUS_ACTIONS, ORG_STATUSES, organizations, orgStatusChanges } from '../schema.ts';

export const ORG_STATUS_CHANGED = 'org.status_changed';

export const SetOrgStatusInput = z.object({
  action: z.enum(ORG_STATUS_ACTIONS),
  /** Staff-only note, kept in the history and the audit log (never shown to the organizer). */
  reason: z.string().trim().min(3).max(500),
});

/**
 * Staff suspend, reactivate or terminate an org (platform actor only, M1.3f). The change is
 * recorded in the org's history and audit log and announced as `org.status_changed@1`: the
 * marketplace projector drops or restores the org's listings, and the owners are told. Public
 * reads check the status themselves (SECURITY DEFINER functions), so pages go offline at once.
 * A terminated org can't be reactivated here (`invalid_state` / `terminated`).
 */
export const setOrgStatusCommand = tenantCommand({
  name: 'tenancy.setOrgStatus',
  input: SetOrgStatusInput,
  output: z.object({
    from: z.enum(ORG_STATUSES),
    to: z.enum(ORG_STATUSES),
    changeId: z.uuid(),
  }),
  entitlement: null,
  permission: 'platform:org.status',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [org] = await tx
      .select({ status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
    if (!org) throw new DomainError('not_found', 'Organization not found');
    const from = org.status as OrgStatus;
    const to = nextOrgStatus(from, input.action);
    if (!to)
      throw new DomainError('invalid_state', `Can't ${input.action} an org that is ${from}`, {
        reason:
          from === 'terminated'
            ? 'terminated'
            : `not_${input.action === 'reactivate' ? 'suspended' : 'live'}`,
        status: from,
      });
    await tx.update(organizations).set({ status: to, updatedAt: ctx.now }).where(eq(organizations.id, orgId));
    const [change] = await tx
      .insert(orgStatusChanges)
      .values({
        orgId,
        action: input.action,
        fromStatus: from,
        toStatus: to,
        reason: input.reason,
        changedBy: actorId(ctx.actor),
      })
      .returning({ id: orgStatusChanges.id });
    if (!change) throw new DomainError('internal');
    emit({
      type: ORG_STATUS_CHANGED,
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, changeId: change.id, action: input.action, from, to },
    });
    return { from, to, changeId: change.id };
  },
  audit: (input, r) => ({
    action: 'org.status_change',
    targetType: 'organization',
    targetId: null,
    data: { statusAction: input.action, from: r.from, to: r.to, reasonText: input.reason },
  }),
});

export const OrgStatusChangeDto = z.object({
  action: z.enum(ORG_STATUS_ACTIONS),
  from: z.enum(ORG_STATUSES),
  to: z.enum(ORG_STATUSES),
  reason: z.string(),
  changedBy: z.string(),
  at: z.date(),
});

/** Staff view: the org's status changes with their notes, newest first (platform actor only). */
export const orgStatusHistoryQuery = tenantQuery({
  name: 'tenancy.orgStatusHistory',
  input: z.object({}),
  output: z.array(OrgStatusChangeDto),
  entitlement: null,
  permission: 'platform:org.status',
  handler: async ({ tx }) =>
    (await tx.select().from(orgStatusChanges).orderBy(desc(orgStatusChanges.createdAt))).map((r) => ({
      action: r.action as (typeof ORG_STATUS_ACTIONS)[number],
      from: r.fromStatus as OrgStatus,
      to: r.toStatus as OrgStatus,
      reason: r.reason,
      changedBy: r.changedBy,
      at: r.createdAt,
    })),
});

async function roleTx(tx: TenantTx, orgId: string, userId: string): Promise<OrgRole | null> {
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return (m?.role as OrgRole | undefined) ?? null;
}

/**
 * The command pipeline's org gate (M1.3f): a suspended org is read-only for its members, API keys
 * and the public; a terminated one refuses everything but personal actions and the owners'
 * exports. Platform actors (staff, the worker, webhooks, door devices) pass. Refusals are
 * `invalid_state` with `reason: org_suspended | org_terminated`.
 */
export const orgStatusGate: NonNullable<CommandPorts<TenantTx>['orgGate']> = {
  async check(tx, ctx, command) {
    const orgId = requireOrg(ctx);
    const [org] = await tx
      .select({ status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    // No row: the org doesn't exist (or isn't visible): the command itself answers.
    if (!org) return;
    const status = org.status;
    if (status === 'active' || status === 'limited' || ctx.actor.type === 'system') return;
    const role = ctx.actor.type === 'user' ? await roleTx(tx, orgId, ctx.actor.userId) : null;
    const refusal = orgWriteRefusal({
      status,
      actorType: ctx.actor.type,
      role,
      command: command.name,
      category: command.category,
    });
    if (refusal)
      throw new DomainError(
        'invalid_state',
        refusal === 'org_suspended' ? 'This organization is suspended' : 'This organization is closed',
        { reason: refusal },
      );
  },
};

const ChangedPayload = z.object({
  orgId: z.uuid(),
  changeId: z.uuid(),
  to: z.enum(ORG_STATUSES),
  from: z.enum(ORG_STATUSES),
});

/**
 * Tell the owners at once when staff suspend, reactivate or close their org (in-app + email,
 * `tenancy.org-status`, 13 locales). The staff note is not included.
 */
export function orgStatusNotice(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'tenancy.org-status-notice',
    events: [`${ORG_STATUS_CHANGED}@1`],
    handle: async (tx, event) => {
      const p = ChangedPayload.parse(event.payload);
      const org = await organizationBrandTx(tx, p.orgId);
      if (!org) return;
      const status = p.to === 'active' ? 'reactivated' : p.to;
      await deps.notifier.notifyMembers(tx, {
        kind: 'tenancy.org-status',
        params: { url: `${deps.appOrigin}/o/${org.slug}`, status },
        dedupeKey: `org-status:${p.changeId}`,
        // The owners' activity log shows the change (the org home isn't an allowed inbox link).
        href: '/activity',
      });
    },
  });
}
