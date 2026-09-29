import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { limitedRefusal } from '../domain/onboarding.ts';
import { organizations, orgSuspensions, SUSPENSION_KINDS } from '../schema.ts';

export type SuspensionKind = (typeof SUSPENSION_KINDS)[number];

/** The org's active kill switches (inside the caller's transaction). */
export async function activeSuspensionsTx(tx: TenantTx): Promise<Set<SuspensionKind>> {
  const rows = await tx
    .select({ kind: orgSuspensions.kind })
    .from(orgSuspensions)
    .where(isNull(orgSuspensions.liftedAt));
  return new Set(rows.map((r) => r.kind as SuspensionKind));
}

/**
 * Pause a capability from inside another module's command (M3.5a: the complaint-rate auto-pause).
 * Same row as a staff pause; `createdBy` names the system rule. Returns whether it changed; the
 * caller emits `org.suspension_changed@1` from its own command.
 */
export async function pauseCapabilityTx(
  tx: TenantTx,
  orgId: string,
  kind: SuspensionKind,
  reason: string,
  createdBy: string,
): Promise<boolean> {
  const rows = await tx
    .insert(orgSuspensions)
    .values({ orgId, kind, reason, createdBy })
    .onConflictDoNothing()
    .returning({ id: orgSuspensions.id });
  return rows.length > 0;
}

/** Lift a capability pause from inside another module's (audited, staff-only) command. */
export async function liftCapabilityTx(
  tx: TenantTx,
  kind: SuspensionKind,
  liftedBy: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(orgSuspensions)
    .set({ liftedAt: now, liftedBy, updatedAt: now })
    .where(and(eq(orgSuspensions.kind, kind), isNull(orgSuspensions.liftedAt)))
    .returning({ id: orgSuspensions.id });
  return rows.length > 0;
}

const PAUSED_REASON: Record<SuspensionKind, string> = {
  pause_checkout: 'checkout_paused',
  pause_publishing: 'publishing_paused',
  pause_messaging: 'messaging_paused',
};

/**
 * Throw `invalid_state` (reason `checkout_paused` etc.) when staff paused this capability. Guest
 * messaging is also closed to a `limited` org (M3.11a: self-serve orgs until onboarding is done;
 * reason `org_limited`).
 */
export async function assertNotPausedTx(tx: TenantTx, kind: SuspensionKind): Promise<void> {
  const [row] = await tx
    .select({ id: orgSuspensions.id })
    .from(orgSuspensions)
    .where(and(eq(orgSuspensions.kind, kind), isNull(orgSuspensions.liftedAt)))
    .limit(1);
  if (row)
    throw new DomainError('invalid_state', 'Paused by Yayatoh support', { reason: PAUSED_REASON[kind] });
  if (kind === 'pause_messaging') {
    const [org] = await tx.select({ status: organizations.status }).from(organizations).limit(1);
    if (org && limitedRefusal(org.status, 'bulk_messaging'))
      throw new DomainError('invalid_state', 'Finish setting up your organization to message guests', {
        reason: 'org_limited',
      });
  }
}

/**
 * Staff turn a kill switch on or off (platform actor only). Idempotent: pausing twice keeps the
 * first pause; lifting when nothing is paused is a no-op. Emits `org.suspension_changed@1`.
 */
export const setSuspensionCommand = tenantCommand({
  name: 'tenancy.setSuspension',
  input: z.object({
    kind: z.enum(SUSPENSION_KINDS),
    paused: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  }),
  output: z.object({ kind: z.enum(SUSPENSION_KINDS), paused: z.boolean(), changed: z.boolean() }),
  entitlement: null,
  permission: 'platform:org.suspend',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    let changed: boolean;
    if (input.paused) {
      const rows = await tx
        .insert(orgSuspensions)
        .values({ orgId, kind: input.kind, reason: input.reason, createdBy: actorId(ctx.actor) })
        .onConflictDoNothing()
        .returning({ id: orgSuspensions.id });
      changed = rows.length > 0;
    } else {
      const rows = await tx
        .update(orgSuspensions)
        .set({ liftedAt: ctx.now, liftedBy: actorId(ctx.actor), updatedAt: ctx.now })
        .where(and(eq(orgSuspensions.kind, input.kind), isNull(orgSuspensions.liftedAt)))
        .returning({ id: orgSuspensions.id });
      changed = rows.length > 0;
    }
    if (changed)
      emit({
        type: 'org.suspension_changed',
        version: 1,
        aggregateType: 'organization',
        aggregateId: orgId,
        payload: { orgId, kind: input.kind, paused: input.paused },
      });
    return { kind: input.kind, paused: input.paused, changed };
  },
  audit: (input, r) => ({
    action: input.paused ? 'org.pause' : 'org.unpause',
    targetType: 'organization',
    targetId: null,
    data: { kind: input.kind, reason: input.reason, changed: r?.changed },
  }),
});

export const SuspensionDto = z.object({ kind: z.enum(SUSPENSION_KINDS), since: z.date() });

/** What the organizer sees: which capabilities are paused, since when (never the staff note). */
export const suspensionsQuery = tenantQuery({
  name: 'tenancy.suspensions',
  input: z.object({}),
  output: z.array(SuspensionDto),
  entitlement: null,
  permission: 'org:read',
  handler: async ({ tx }) =>
    (
      await tx
        .select({ kind: orgSuspensions.kind, since: orgSuspensions.createdAt })
        .from(orgSuspensions)
        .where(isNull(orgSuspensions.liftedAt))
    ).map((r) => ({ kind: r.kind as SuspensionKind, since: r.since })),
});

/** Staff view: active and past pauses with their notes (platform actor only). */
export const suspensionHistoryQuery = tenantQuery({
  name: 'tenancy.suspensionHistory',
  input: z.object({}),
  output: z.array(
    z.object({
      kind: z.enum(SUSPENSION_KINDS),
      reason: z.string(),
      createdBy: z.string(),
      since: z.date(),
      liftedAt: z.date().nullable(),
      liftedBy: z.string().nullable(),
    }),
  ),
  entitlement: null,
  permission: 'platform:org.suspend',
  handler: async ({ tx }) =>
    (await tx.select().from(orgSuspensions).orderBy(orgSuspensions.createdAt)).map((r) => ({
      kind: r.kind as SuspensionKind,
      reason: r.reason,
      createdBy: r.createdBy,
      since: r.createdAt,
      liftedAt: r.liftedAt,
      liftedBy: r.liftedBy,
    })),
});
