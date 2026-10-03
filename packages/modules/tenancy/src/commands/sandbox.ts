import { randomBytes } from 'node:crypto';
import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  requireOrg,
  uuidv7,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AGREEMENT_DOCUMENTS, PLATFORM_AGREEMENTS } from '../domain/agreements.ts';
import {
  agreementAcceptances,
  apiKeys,
  memberships,
  organizations,
  orgStatusChanges,
  sandboxOrgs,
} from '../schema.ts';
import { startOnboardingTx } from './onboarding.ts';
import { ORG_STATUS_CHANGED } from './org-status.ts';

/** Live sandboxes per org (M6.3a; a fixed placeholder until plans are priced, P6-13). */
export const MAX_SANDBOX_ORGS = 10;

export const SandboxDto = z.object({
  id: z.uuid(),
  sandboxOrgId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
  createdBy: z.uuid().nullable(),
});
export type SandboxDto = z.infer<typeof SandboxDto>;

export const CreateSandboxInput = z.object({ name: z.string().trim().min(1).max(60) });

/**
 * The sandbox org's name: the parent's, then the sandbox's (`Lakeside Events – Staging`), so the
 * org switcher groups it under its parent and lists the parent first.
 */
export function sandboxOrgName(parentName: string, name: string): string {
  return `${parentName.slice(0, 57).trimEnd()} – ${name}`;
}

/** `lakeside-events-sandbox-3f9a1c`: the parent's address (shortened) and a random tail. */
export function sandboxSlug(parentSlug: string, tail = randomBytes(3).toString('hex')): string {
  return `${parentSlug.slice(0, 40).replace(/-+$/, '')}-sandbox-${tail}`;
}

const toDto = (r: typeof sandboxOrgs.$inferSelect): SandboxDto => ({
  id: r.id,
  sandboxOrgId: r.sandboxOrgId,
  name: r.name,
  slug: r.slug,
  createdAt: r.createdAt,
  createdBy: r.createdBy,
});

/**
 * Step 1 of creating a sandbox (M6.3a), in the parent org: the link row, owned by the parent.
 * A sandbox can't have sandboxes, and an org has at most `MAX_SANDBOX_ORGS` live ones.
 */
export const createSandboxCommand = tenantCommand({
  name: 'tenancy.createSandbox',
  input: CreateSandboxInput,
  output: SandboxDto,
  entitlement: 'api_access',
  permission: 'sandbox:manage',
  handler: async ({ input, ctx, tx }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Sign in to create a sandbox');
    const [parent] = await tx
      .select({ slug: organizations.slug, sandbox: organizations.sandbox })
      .from(organizations)
      .where(eq(organizations.id, requireOrg(ctx)));
    if (!parent) throw new DomainError('not_found');
    if (parent.sandbox)
      throw new DomainError('invalid_state', 'A sandbox cannot have sandboxes of its own', {
        reason: 'sandbox_of_sandbox',
      });
    const [live] = await tx.select({ n: count() }).from(sandboxOrgs).where(isNull(sandboxOrgs.deletedAt));
    if ((live?.n ?? 0) >= MAX_SANDBOX_ORGS)
      throw new DomainError('invalid_state', `At most ${MAX_SANDBOX_ORGS} sandboxes`, {
        reason: 'sandbox_limit',
        limit: MAX_SANDBOX_ORGS,
      });
    const [row] = await tx
      .insert(sandboxOrgs)
      .values({
        orgId: requireOrg(ctx),
        sandboxOrgId: uuidv7(ctx.now.getTime()),
        name: input.name,
        slug: sandboxSlug(parent.slug),
        createdBy: ctx.actor.userId,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row);
  },
  audit: (_input, r) => ({
    action: 'sandbox.create',
    targetType: 'organization',
    targetId: r.sandboxOrgId,
    data: { kind: 'sandbox' },
  }),
});

const ProvisionSandboxInput = z.object({
  parentOrgId: z.uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().min(3).max(63),
  ownerUserId: z.uuid(),
  timezone: z.string(),
  country: z.string(),
  currency: z.string(),
  defaultLocale: z.string(),
  defaultProfile: z.string(),
});

/**
 * Step 2 (M6.3a), in the new sandbox org (system actor): the org row (`sandbox`, its parent), its
 * creator as owner, the platform terms they accepted for the parent, and onboarding. The parent's
 * link must exist (read through the SECURITY DEFINER `tenancy.sandbox_parent_of`).
 */
export const provisionSandboxOrgCommand = tenantCommand({
  name: 'tenancy.provisionSandboxOrg',
  input: ProvisionSandboxInput,
  output: z.object({ id: z.uuid(), slug: z.string() }),
  entitlement: null,
  permission: 'platform:sandbox.provision',
  handler: async ({ input, ctx, tx, emit }) => {
    const id = requireOrg(ctx);
    const [link] = await tx.execute<{ parent: string | null }>(
      sql`select tenancy.sandbox_parent_of(${id}) as parent`,
    );
    if (!link?.parent || link.parent !== input.parentOrgId)
      throw new DomainError('forbidden', 'No sandbox link for this org', { reason: 'sandbox_link_missing' });
    const [row] = await tx
      .insert(organizations)
      .values({
        id,
        orgId: id,
        slug: input.slug,
        name: input.name,
        timezone: input.timezone,
        country: input.country,
        currency: input.currency,
        defaultLocale: input.defaultLocale,
        defaultProfile: input.defaultProfile,
        status: 'active',
        sandbox: true,
        sandboxParentOrgId: input.parentOrgId,
      })
      .returning({ id: organizations.id, slug: organizations.slug, kind: organizations.kind });
    if (!row) throw new DomainError('internal');
    await startOnboardingTx(tx, id, 'direct', ctx.now, ['terms']);
    await tx.insert(memberships).values({ orgId: id, userId: input.ownerUserId, role: 'owner' });
    for (const document of AGREEMENT_DOCUMENTS)
      await tx.insert(agreementAcceptances).values({
        orgId: id,
        document,
        version: PLATFORM_AGREEMENTS[document].version,
        acceptedBy: input.ownerUserId,
        acceptedAt: ctx.now,
      });
    emit({
      type: 'organization.created',
      version: 1,
      aggregateType: 'organization',
      aggregateId: id,
      payload: { orgId: id, slug: row.slug, kind: row.kind, defaultProfile: input.defaultProfile },
    });
    return { id: row.id, slug: row.slug };
  },
  audit: (input, r) => ({
    action: 'sandbox.provision',
    targetType: 'organization',
    targetId: r.id,
    data: { kind: 'sandbox', parentOrgId: input.parentOrgId },
  }),
});

/** Compensation (system): a sandbox whose provisioning failed loses its link again. */
const discardSandboxLinkCommand = tenantCommand({
  name: 'tenancy.discardSandboxLink',
  input: z.object({ sandboxOrgId: z.uuid() }),
  output: z.object({ discarded: z.boolean() }),
  entitlement: null,
  permission: 'platform:sandbox.provision',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(sandboxOrgs)
      .where(eq(sandboxOrgs.sandboxOrgId, input.sandboxOrgId))
      .returning({ id: sandboxOrgs.id });
    return { discarded: rows.length > 0 };
  },
  audit: (input) => ({ action: 'sandbox.discard', targetType: 'organization', targetId: input.sandboxOrgId }),
});

/**
 * Create a sandbox org linked to the context org (M6.3a): the link (as the member, who needs
 * `sandbox:manage`), then the org itself (as the platform), copying the parent's locale, timezone,
 * country, currency and profile. The member becomes its owner. Seeded data and fake payments are
 * the caller's next step (higher tiers).
 */
export async function createSandboxOrg(
  ctx: Ctx,
  input: z.input<typeof CreateSandboxInput>,
  ports: CommandPorts<TenantTx>,
): Promise<SandboxDto> {
  const link = await executeCommand(createSandboxCommand, input, ctx, ports);
  const parentId = requireOrg(ctx);
  const [parent] = await withTenant(ctx, (tx) =>
    tx
      .select({
        name: organizations.name,
        timezone: organizations.timezone,
        country: organizations.country,
        currency: organizations.currency,
        defaultLocale: organizations.defaultLocale,
        defaultProfile: organizations.defaultProfile,
      })
      .from(organizations)
      .where(eq(organizations.id, parentId)),
  );
  const system = (orgId: string) =>
    createCtx({ orgId, actor: { type: 'system', name: 'sandbox' }, requestId: ctx.requestId });
  try {
    if (!parent || ctx.actor.type !== 'user') throw new DomainError('internal');
    const { name: parentName, ...settings } = parent;
    await executeCommand(
      provisionSandboxOrgCommand,
      {
        parentOrgId: parentId,
        name: sandboxOrgName(parentName, link.name),
        slug: link.slug,
        ownerUserId: ctx.actor.userId,
        ...settings,
      },
      system(link.sandboxOrgId),
      ports,
    );
  } catch (err) {
    await executeCommand(
      discardSandboxLinkCommand,
      { sandboxOrgId: link.sandboxOrgId },
      system(parentId),
      ports,
    );
    throw err;
  }
  return link;
}

export const listSandboxesQuery = tenantQuery({
  name: 'tenancy.listSandboxes',
  input: z.object({}),
  output: z.array(SandboxDto),
  entitlement: 'core',
  permission: 'sandbox:manage',
  handler: async ({ tx }) =>
    (
      await tx
        .select()
        .from(sandboxOrgs)
        .where(isNull(sandboxOrgs.deletedAt))
        .orderBy(asc(sandboxOrgs.createdAt))
    ).map(toDto),
});

/** Step 1 of deleting a sandbox (M6.3a), in the parent: the link is marked deleted (step-up). */
export const deleteSandboxCommand = tenantCommand({
  name: 'tenancy.deleteSandbox',
  input: z.object({ sandboxId: z.uuid() }),
  output: SandboxDto,
  entitlement: 'core',
  permission: 'sandbox:manage',
  stepUp: true,
  category: 'delete',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(sandboxOrgs)
      .set({
        deletedAt: ctx.now,
        deletedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(and(eq(sandboxOrgs.id, input.sandboxId), isNull(sandboxOrgs.deletedAt)))
      .returning();
    if (!row) throw new DomainError('not_found', 'Sandbox not found');
    return toDto(row);
  },
  audit: (_input, r) => ({
    action: 'sandbox.delete',
    targetType: 'organization',
    targetId: r.sandboxOrgId,
    data: { kind: 'sandbox' },
  }),
});

/**
 * Step 2 (M6.3a), in the sandbox org (system actor): it is closed (`terminated`, so its public
 * pages go offline and the marketplace drops it), every member loses access and every key is
 * revoked. Its fake data stays inert (ledgers are append-only); a purge job is later work.
 */
export const retireSandboxOrgCommand = tenantCommand({
  name: 'tenancy.retireSandboxOrg',
  input: z.object({ parentOrgId: z.uuid() }),
  output: z.object({ id: z.uuid(), membersRemoved: z.int(), keysRevoked: z.int() }),
  entitlement: null,
  permission: 'platform:sandbox.retire',
  handler: async ({ input, ctx, tx, emit }) => {
    const id = requireOrg(ctx);
    const [org] = await tx
      .select({
        status: organizations.status,
        sandbox: organizations.sandbox,
        parent: organizations.sandboxParentOrgId,
      })
      .from(organizations)
      .where(eq(organizations.id, id))
      .for('update');
    if (!org?.sandbox || org.parent !== input.parentOrgId)
      throw new DomainError('forbidden', 'Not a sandbox of this org', { reason: 'not_a_sandbox' });
    const members = await tx.delete(memberships).returning({ id: memberships.id });
    const keys = await tx
      .update(apiKeys)
      .set({ revokedAt: ctx.now, updatedAt: ctx.now })
      .where(isNull(apiKeys.revokedAt))
      .returning({ id: apiKeys.id });
    if (org.status !== 'terminated') {
      await tx
        .update(organizations)
        .set({ status: 'terminated', updatedAt: ctx.now })
        .where(eq(organizations.id, id));
      const [change] = await tx
        .insert(orgStatusChanges)
        .values({
          orgId: id,
          action: 'terminate',
          fromStatus: org.status,
          toStatus: 'terminated',
          reason: 'Sandbox deleted by its organization',
          changedBy: 'system:sandbox',
        })
        .returning({ id: orgStatusChanges.id });
      if (!change) throw new DomainError('internal');
      emit({
        type: ORG_STATUS_CHANGED,
        version: 1,
        aggregateType: 'organization',
        aggregateId: id,
        payload: { orgId: id, changeId: change.id, action: 'terminate', from: org.status, to: 'terminated' },
      });
    }
    return { id, membersRemoved: members.length, keysRevoked: keys.length };
  },
  audit: (_input, r) => ({
    action: 'sandbox.retire',
    targetType: 'organization',
    targetId: r.id,
    data: { kind: 'sandbox', count: r.membersRemoved, total: r.keysRevoked },
  }),
});

/** Compensation (system): the link of a sandbox that could not be retired comes back. */
const restoreSandboxLinkCommand = tenantCommand({
  name: 'tenancy.restoreSandboxLink',
  input: z.object({ sandboxId: z.uuid() }),
  output: z.object({ restored: z.boolean() }),
  entitlement: null,
  permission: 'platform:sandbox.retire',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(sandboxOrgs)
      .set({ deletedAt: null, deletedBy: null, updatedAt: ctx.now })
      .where(eq(sandboxOrgs.id, input.sandboxId))
      .returning({ id: sandboxOrgs.id });
    return { restored: rows.length > 0 };
  },
  audit: (input) => ({ action: 'sandbox.restoreLink', targetType: 'sandbox', targetId: input.sandboxId }),
});

/** Delete a sandbox of the context org (M6.3a): the link (member, step-up), then the org itself. */
export async function deleteSandboxOrg(
  ctx: Ctx,
  input: { sandboxId: string },
  ports: CommandPorts<TenantTx>,
): Promise<SandboxDto> {
  const link = await executeCommand(deleteSandboxCommand, input, ctx, ports);
  const parentId = requireOrg(ctx);
  try {
    await executeCommand(
      retireSandboxOrgCommand,
      { parentOrgId: parentId },
      createCtx({
        orgId: link.sandboxOrgId,
        actor: { type: 'system', name: 'sandbox' },
        requestId: ctx.requestId,
      }),
      ports,
    );
  } catch (err) {
    await executeCommand(
      restoreSandboxLinkCommand,
      { sandboxId: link.id },
      createCtx({ orgId: parentId, actor: { type: 'system', name: 'sandbox' }, requestId: ctx.requestId }),
      ports,
    );
    throw err;
  }
  return link;
}

/** Is this org a sandbox (M6.3a)? Read under its own RLS (fake payments, no marketplace, banner). */
export async function isSandboxOrg(orgId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'sandbox-check' } });
  const [row] = await withTenant(ctx, (tx) =>
    tx.select({ sandbox: organizations.sandbox }).from(organizations).where(eq(organizations.id, orgId)),
  );
  return row?.sandbox === true;
}

/** The same, inside an existing tenant transaction of that org. */
export async function isSandboxOrgTx(tx: TenantTx, orgId: string): Promise<boolean> {
  const [row] = await tx
    .select({ sandbox: organizations.sandbox })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.sandbox === true;
}
