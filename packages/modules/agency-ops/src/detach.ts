import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { existingTemplateIdsTx } from '@yayatoh/templates';
import { liveAgencyGrantTx, revokeAgencyGrantTx, revokeAllAgencyStaffTx } from '@yayatoh/tenancy';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { liveClientTx, requireAgencyV2Tx, userOf } from './common.ts';
import {
  brandKits,
  DETACH_INITIATORS,
  detachments,
  fanoutTargets,
  publications,
  RECEIVED_KINDS,
  receivedItems,
} from './schema.ts';

/**
 * Handover and detach (M6.8b). The client leaves its agency with **all its data**: events,
 * orders, contacts, campaigns (fanned-out ones included), the template and brand-kit copies it
 * received: they are the client's own rows and nothing here deletes any of them. What ends:
 * the agency's grant (revoked: the agency's people lose access on their next request), every
 * team place and day-of pass under it, and the links back to the agency's originals (cleared, so
 * a re-publish can no longer reach the client's copies). The agency's private template parts were
 * never copied (`publicSnapshot`), so there is nothing of them to take back.
 *
 * The client detaches from its Agencies page (`members:manage`, one click like revoking); the
 * agency hands a client over from its own pages (`agency:manage`), which runs the same command
 * in the client as a system actor after checking the agency's live grant.
 */

export const DetachDto = z.object({
  agencyOrgId: z.uuid(),
  grantId: z.uuid(),
  initiatedBy: z.enum(DETACH_INITIATORS),
  templatesKept: z.int(),
  brandKitsKept: z.int(),
  campaignsKept: z.int(),
  staffRevoked: z.int(),
});
export type DetachDto = z.infer<typeof DetachDto>;

const HANDOVER_ACTOR = 'agency.handover';

export const detachAgencyCommand = tenantCommand({
  name: 'agencyOps.detachAgency',
  input: z.object({
    grantId: z.uuid(),
    /** Set only by the agency's handover (a system actor of the client): the agency person. */
    handoverBy: z.uuid().nullable().default(null),
  }),
  output: DetachDto,
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    await requireAgencyV2Tx(tx);
    const orgId = requireOrg(ctx);
    const handover = ctx.actor.type === 'system' && ctx.actor.name === HANDOVER_ACTOR;
    if (handover !== (input.handoverBy !== null))
      throw new DomainError('forbidden', 'Only the agency’s handover names its person');
    const by = handover ? (input.handoverBy as string) : userOf(ctx);
    const grant = await liveAgencyGrantTx(tx, input.grantId);
    if (!grant) throw new DomainError('not_found', 'Agency access not found');
    const agencyOrgId = grant.agencyOrgId;

    const received = await tx
      .select()
      .from(receivedItems)
      .where(and(eq(receivedItems.agencyOrgId, agencyOrgId), isNull(receivedItems.detachedAt)));
    const ids = (kind: (typeof RECEIVED_KINDS)[number]) =>
      received.filter((r) => r.kind === kind).map((r) => r.localId);
    const templatesKept = (await existingTemplateIdsTx(tx, ids('template'))).length;
    const [kits] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(brandKits)
      .where(eq(brandKits.receivedFromAgencyOrgId, agencyOrgId));
    // The links back to the agency's originals end; the copies stay the client's.
    await tx
      .update(receivedItems)
      .set({ sourceId: null, detachedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(receivedItems.agencyOrgId, agencyOrgId), isNull(receivedItems.detachedAt)));
    const staffRevoked = await revokeAllAgencyStaffTx(tx, grant.grantId, by, ctx.now);
    await revokeAgencyGrantTx(tx, grant.grantId, by, ctx.now, emit);
    const result: DetachDto = {
      agencyOrgId,
      grantId: grant.grantId,
      initiatedBy: handover ? 'agency' : 'client',
      templatesKept,
      brandKitsKept: kits?.n ?? 0,
      campaignsKept: ids('campaign').length,
      staffRevoked,
    };
    await tx.insert(detachments).values({ orgId, ...result, byUserId: by });
    emit({
      type: 'agency_ops.client_detached',
      version: 1,
      aggregateType: 'agency_grant',
      aggregateId: grant.grantId,
      payload: { clientOrgId: orgId, agencyOrgId, grantId: grant.grantId, initiatedBy: result.initiatedBy },
    });
    return result;
  },
  audit: (_input, r) => ({
    action: r.initiatedBy === 'agency' ? 'agency.handover' : 'agency.detach',
    targetType: 'agency_grant',
    targetId: r.grantId,
    data: {
      kind: r.initiatedBy,
      count: r.templatesKept + r.brandKitsKept + r.campaignsKept,
      total: r.staffRevoked,
    },
  }),
});

/** Agency side: check the live grant before a handover (and record it in the agency's audit log). */
export const prepareHandoverCommand = tenantCommand({
  name: 'agencyOps.prepareHandover',
  input: z.object({ clientOrgId: z.uuid() }),
  output: z.object({ grantId: z.uuid() }),
  entitlement: 'agency',
  permission: 'agency:manage',
  stepUp: true,
  handler: async ({ input, tx }) => {
    await requireAgencyV2Tx(tx);
    const g = await liveClientTx(tx, input.clientOrgId);
    return { grantId: g.grantId };
  },
  audit: (input) => ({ action: 'agency.handover', targetType: 'organization', targetId: input.clientOrgId }),
});

/**
 * The agency hands a client over: the same detach, run in the client by the system on the agency
 * person's behalf (they hold no `members:manage` in the client). Step-up on the agency side.
 */
export async function handOverClient(
  ctx: Ctx,
  input: { clientOrgId: string },
  ports: CommandPorts<TenantTx>,
): Promise<DetachDto> {
  const by = userOf(ctx);
  const { grantId } = await executeCommand(prepareHandoverCommand, input, ctx, ports);
  return executeCommand(
    detachAgencyCommand,
    { grantId, handoverBy: by },
    createCtx({ orgId: input.clientOrgId, actor: { type: 'system', name: HANDOVER_ACTOR }, now: ctx.now }),
    ports,
  );
}

const DetachedPayload = z.object({
  clientOrgId: z.uuid(),
  agencyOrgId: z.uuid(),
  grantId: z.uuid(),
  initiatedBy: z.enum(DETACH_INITIATORS),
});

/**
 * Outbox subscriber: a detached client's publications and pending fan-out targets are marked
 * `detached` on the agency's side (in the agency's tenant).
 */
export const agencyDetachSubscriber = defineSubscriber({
  name: 'agency_ops.detached',
  events: ['agency_ops.client_detached@1'],
  handle: async (_tx, event) => {
    const p = DetachedPayload.safeParse(event.payload);
    if (!p.success || p.data.clientOrgId !== event.orgId) return;
    const now = new Date();
    const agencyCtx = createCtx({
      orgId: p.data.agencyOrgId,
      actor: { type: 'system', name: 'agency_ops.detached' },
      now,
    });
    await withTenant(agencyCtx, async (atx) => {
      await atx
        .update(publications)
        .set({ status: 'detached', updatedAt: now })
        .where(eq(publications.clientOrgId, p.data.clientOrgId));
      await atx
        .update(fanoutTargets)
        .set({ status: 'detached', updatedAt: now })
        .where(and(eq(fanoutTargets.clientOrgId, p.data.clientOrgId), eq(fanoutTargets.status, 'pending')));
    });
  },
});

// ---------------------------------------------------------------- client: what it received

export const ReceivedItemDto = z.object({
  kind: z.enum(RECEIVED_KINDS),
  localId: z.uuid(),
  agencyOrgId: z.uuid(),
  attached: z.boolean(),
  receivedAt: z.date(),
});

export const ReceivedBrandKitDto = z.object({
  id: z.uuid(),
  name: z.string(),
  brandColor: z.string(),
  receivedFromAgencyOrgId: z.uuid().nullable(),
  appliedAt: z.date().nullable(),
});

export const ClientAgencyOpsDto = z.object({
  items: z.array(ReceivedItemDto),
  brandKits: z.array(ReceivedBrandKitDto),
  detachments: z.array(DetachDto.extend({ at: z.date() })),
});
export type ClientAgencyOpsDto = z.infer<typeof ClientAgencyOpsDto>;

/** The client's view: what its agencies sent, the brand kits it can apply, and past detaches. */
export const clientAgencyOpsQuery = tenantQuery({
  name: 'agencyOps.clientView',
  input: z.object({}),
  output: ClientAgencyOpsDto,
  entitlement: 'core',
  permission: 'members:read',
  handler: async ({ tx }) => {
    const items = await tx.select().from(receivedItems).orderBy(desc(receivedItems.createdAt)).limit(200);
    const kits = await tx
      .select()
      .from(brandKits)
      .where(sql`${brandKits.receivedFromAgencyOrgId} is not null`)
      .orderBy(brandKits.name);
    const past = await tx.select().from(detachments).orderBy(desc(detachments.createdAt)).limit(20);
    return ClientAgencyOpsDto.parse({
      items: items.map((i) => ({
        kind: i.kind,
        localId: i.localId,
        agencyOrgId: i.agencyOrgId,
        attached: i.detachedAt === null,
        receivedAt: i.createdAt,
      })),
      brandKits: kits,
      detachments: past.map((d) => ({ ...d, initiatedBy: d.initiatedBy, at: d.createdAt })),
    });
  },
});
