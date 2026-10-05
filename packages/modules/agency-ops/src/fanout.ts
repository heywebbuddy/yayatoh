import { saveSegmentCommand } from '@yayatoh/audiences';
import {
  CampaignName,
  createCampaignCommand,
  postalAddressQuery,
  saveCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
} from '@yayatoh/campaigns';
import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  actingAgency,
  agencyNameTx,
  liveClientsTx,
  requireAgencyOrgTx,
  requireAgencyV2Tx,
  userOf,
  viaGrantCtx,
} from './common.ts';
import { errorCodeOf, fanoutContent, fanoutSegment, hasPostalAddress } from './domain.ts';
import {
  FANOUT_AUDIENCES,
  FANOUT_MODES,
  FANOUT_TARGET_STATUSES,
  fanouts,
  fanoutTargets,
  receivedItems,
} from './schema.ts';

/**
 * Per-client campaign fan-out (M6.8b). The agency writes one message; each chosen client gets
 * **its own campaign in its own org**, created by the agency user acting through that client's
 * live grant (so a viewer grant is refused there): the client's own audience (a segment in the
 * client's DSL), the client's footer and postal address, its sending domain and quotas, and at
 * send time the client's consent and suppression rules (the campaigns module's recipient
 * snapshot). Nothing crosses orgs except ids and statuses: the agency never reads a recipient.
 */

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const FanoutInput = z.object({
  name: Text(1, 120),
  subject: Text(1, 150),
  heading: Text(1, 200),
  body: Text(1, 5000),
  audience: z.enum(FANOUT_AUDIENCES),
  mode: z.enum(FANOUT_MODES),
  clientOrgIds: z.array(z.uuid()).min(1).max(50),
});
export type FanoutInput = z.infer<typeof FanoutInput>;

export const FanoutTargetDto = z.object({
  clientOrgId: z.uuid(),
  status: z.enum(FANOUT_TARGET_STATUSES),
  clientCampaignId: z.uuid().nullable(),
  errorCode: z.string().nullable(),
});
export type FanoutTargetDto = z.infer<typeof FanoutTargetDto>;

export const FanoutDto = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: z.string(),
  audience: z.enum(FANOUT_AUDIENCES),
  mode: z.enum(FANOUT_MODES),
  createdAt: z.date(),
  targets: z.array(FanoutTargetDto),
});
export type FanoutDto = z.infer<typeof FanoutDto>;

const Started = z.object({
  fanoutId: z.uuid(),
  agencyName: z.string(),
  targets: z.array(z.object({ clientOrgId: z.uuid(), grantId: z.uuid() })),
  missing: z.array(z.uuid()),
});

/** Agency side: record the fan-out and one pending target per client with a live grant. */
export const createFanoutCommand = tenantCommand({
  name: 'agencyOps.createFanout',
  input: FanoutInput,
  output: Started,
  entitlement: 'agency',
  permission: 'agency:campaigns',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyOrgTx(tx, ctx);
    const orgId = requireOrg(ctx);
    const live = await liveClientsTx(tx);
    const ids = [...new Set(input.clientOrgIds)];
    const [f] = await tx
      .insert(fanouts)
      .values({
        orgId,
        name: input.name,
        subject: input.subject,
        heading: input.heading,
        body: input.body,
        audience: input.audience,
        mode: input.mode,
        createdBy: userOf(ctx),
      })
      .returning();
    if (!f) throw new DomainError('internal');
    // One target per client with a live grant; ids without one are refused (and not stored).
    const targets = ids.filter((id) => live.has(id));
    if (targets.length > 0)
      await tx
        .insert(fanoutTargets)
        .values(
          targets.map((clientOrgId) => ({ orgId, fanoutId: f.id, clientOrgId, status: 'pending' as const })),
        );
    return {
      fanoutId: f.id,
      agencyName: await agencyNameTx(tx, orgId),
      targets: ids.flatMap((id) => {
        const g = live.get(id);
        return g ? [{ clientOrgId: id, grantId: g.grantId }] : [];
      }),
      missing: ids.filter((id) => !live.has(id)),
    };
  },
  audit: (input, r) => ({
    action: 'agencyCampaign.fanout',
    targetType: 'agency_fanout',
    targetId: r.fanoutId,
    data: { count: input.clientOrgIds.length, kind: input.mode },
  }),
});

/** Agency side: one client's outcome. */
export const recordFanoutTargetCommand = tenantCommand({
  name: 'agencyOps.recordFanoutTarget',
  input: FanoutTargetDto.extend({ fanoutId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'agency',
  permission: 'agency:campaigns',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(fanoutTargets)
      .set({
        status: input.status,
        clientCampaignId: input.clientCampaignId,
        errorCode: input.errorCode,
        updatedAt: ctx.now,
      })
      .where(
        and(eq(fanoutTargets.fanoutId, input.fanoutId), eq(fanoutTargets.clientOrgId, input.clientOrgId)),
      );
    return { ok: true as const };
  },
});

/**
 * Client side (the agency acting through its grant, `marketing:write`): note that a campaign of
 * the client came from its agency (the client's "From your agency" list; detach clears the link).
 */
export const receiveCampaignCommand = tenantCommand({
  name: 'agencyOps.receiveCampaign',
  input: z.object({ campaignId: z.uuid(), fanoutId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const { agencyOrgId } = actingAgency(ctx);
    await tx
      .insert(receivedItems)
      .values({
        orgId: requireOrg(ctx),
        kind: 'campaign',
        localId: input.campaignId,
        agencyOrgId,
        sourceId: input.fanoutId,
      })
      .onConflictDoNothing();
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'agencyCampaign.receive',
    targetType: 'campaign',
    targetId: input.campaignId,
  }),
});

/** Create (and maybe send) one client's campaign through its grant; the outcome for the agency. */
async function fanOutToClient(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  fanoutId: string,
  agencyName: string,
  input: FanoutInput,
  target: { clientOrgId: string; grantId: string },
): Promise<FanoutTargetDto> {
  const clientCtx = viaGrantCtx(ctx, target);
  let campaignId: string | null = null;
  try {
    // The client may already use the name: the agency's name in brackets tells them apart.
    let campaign: Awaited<ReturnType<typeof createCampaign>> | null = null;
    const createCampaign = (name: string) =>
      executeCommand(createCampaignCommand, { name, channel: 'email', locale: ctx.locale }, clientCtx, ports);
    for (const name of [input.name, CampaignName.parse(`${input.name} (${agencyName})`.slice(0, 120))]) {
      try {
        campaign = await createCampaign(name);
        break;
      } catch (err) {
        if (!(err instanceof DomainError && err.code === 'conflict')) throw err;
      }
    }
    if (!campaign) throw new DomainError('conflict', 'A campaign with this name exists');
    campaignId = campaign.id;
    await executeCommand(receiveCampaignCommand, { campaignId, fanoutId }, clientCtx, ports);
    const segmentNames = [campaign.name, `${campaign.name.slice(0, 110)} ${fanoutId.slice(-8)}`];
    let segmentId: string | null = null;
    for (const name of segmentNames) {
      try {
        segmentId = (
          await executeCommand(
            saveSegmentCommand,
            { name, definition: fanoutSegment(input.audience) },
            clientCtx,
            ports,
          )
        ).id;
        break;
      } catch (err) {
        if (!(err instanceof DomainError && err.code === 'conflict')) throw err;
      }
    }
    if (!segmentId) throw new DomainError('conflict', 'An audience with this name exists');
    await executeCommand(
      setAudienceCommand,
      { campaignId, audience: { kind: 'segment', segmentId } },
      clientCtx,
      ports,
    );
    // The footer is the client's: without a postal address the draft waits for the client to add one.
    const { postalAddress } = await executeQuery(postalAddressQuery, {}, clientCtx, ports);
    if (!hasPostalAddress(postalAddress))
      return {
        clientOrgId: target.clientOrgId,
        status: 'needs_address',
        clientCampaignId: campaignId,
        errorCode: null,
      };
    await executeCommand(
      saveCampaignCommand,
      {
        campaignId,
        name: campaign.name,
        locale: campaign.locale,
        content: fanoutContent(postalAddress, input),
      },
      clientCtx,
      ports,
    );
    if (input.mode === 'draft')
      return {
        clientOrgId: target.clientOrgId,
        status: 'draft',
        clientCampaignId: campaignId,
        errorCode: null,
      };
    // The client's own send: its recipient snapshot applies its consent and suppression rules.
    await executeCommand(
      sendNowCommand,
      { campaignId },
      viaGrantCtx(ctx, target, `agency-fanout:${fanoutId}:${target.clientOrgId}`),
      ports,
    );
    return { clientOrgId: target.clientOrgId, status: 'sent', clientCampaignId: campaignId, errorCode: null };
  } catch (err) {
    return {
      clientOrgId: target.clientOrgId,
      status: 'failed',
      clientCampaignId: campaignId,
      errorCode: errorCodeOf(err),
    };
  }
}

/**
 * Fan one agency campaign out to clients: one campaign per client, in that client's org, one
 * client at a time. Returns every client's outcome (`sent`, `draft`, `needs_address` when the
 * client has no postal address for the footer yet, or `failed` with its code).
 */
export async function fanOutCampaign(
  ctx: Ctx,
  input: FanoutInput,
  ports: CommandPorts<TenantTx>,
): Promise<{ fanoutId: string; targets: FanoutTargetDto[] }> {
  const parsed = FanoutInput.parse(input);
  const started = await executeCommand(createFanoutCommand, parsed, ctx, ports);
  const targets: FanoutTargetDto[] = started.missing.map((clientOrgId) => ({
    clientOrgId,
    status: 'failed',
    clientCampaignId: null,
    errorCode: 'not_found',
  }));
  for (const t of started.targets) {
    const outcome = await fanOutToClient(ctx, ports, started.fanoutId, started.agencyName, parsed, t);
    await executeCommand(recordFanoutTargetCommand, { ...outcome, fanoutId: started.fanoutId }, ctx, ports);
    targets.push(outcome);
  }
  return { fanoutId: started.fanoutId, targets };
}

/** The agency's fan-outs (newest first) with each client's outcome. */
export const agencyFanoutsQuery = tenantQuery({
  name: 'agencyOps.fanouts',
  input: z.object({}),
  output: z.array(FanoutDto),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ ctx, tx }) => {
    await requireAgencyOrgTx(tx, ctx);
    const rows = await tx.select().from(fanouts).orderBy(desc(fanouts.createdAt)).limit(50);
    if (rows.length === 0) return [];
    const targets = await tx
      .select()
      .from(fanoutTargets)
      .where(
        inArray(
          fanoutTargets.fanoutId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) =>
      FanoutDto.parse({
        ...r,
        targets: targets.filter((t) => t.fanoutId === r.id),
      }),
    );
  },
});
