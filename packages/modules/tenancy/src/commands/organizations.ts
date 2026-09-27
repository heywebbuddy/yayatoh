import { createHash } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation, withoutTenant } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  type DomainEvent,
  executeCommand,
  requireOrg,
  uuidv7,
} from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AGREEMENT_DOCUMENTS, PLATFORM_AGREEMENTS } from '../domain/agreements.ts';
import { CreateOrganizationInput, OrganizationDto, UpdateOrganizationInput } from '../dto.ts';
import { agreementAcceptances, memberships, organizations } from '../schema.ts';
import { ensureManagedDomainTx } from './domains.ts';

type Emit = (e: DomainEvent) => void;

/** The org row (id = the context's new org id) and, for a person, their owner membership. */
async function insertOrganizationTx(
  tx: TenantTx,
  ctx: Ctx,
  input: z.output<typeof CreateOrganizationInput>,
  emit: Emit,
) {
  const id = requireOrg(ctx);
  let row: typeof organizations.$inferSelect | undefined;
  try {
    [row] = await tx
      .insert(organizations)
      .values({ id, orgId: id, ...input })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, 'organizations_slug_key')) {
      throw new DomainError('conflict', 'This address is already taken', { field: 'slug' });
    }
    throw err;
  }
  if (!row) throw new DomainError('internal');
  if (ctx.actor.type === 'user') {
    await tx.insert(memberships).values({ orgId: id, userId: ctx.actor.userId, role: 'owner' });
  }
  // The tenant-apex subdomain comes with every org (roadmap §4.4).
  await ensureManagedDomainTx(tx, ctx, row.slug);
  emit({
    type: 'organization.created',
    version: 1,
    aggregateType: 'organization',
    aggregateId: id,
    payload: { orgId: id, slug: row.slug, kind: row.kind, defaultProfile: row.defaultProfile },
  });
  return row;
}

/** Signup codes are case- and separator-insensitive; only their SHA-256 is stored. */
export const hashSignupCode = (code: string) =>
  createHash('sha256')
    .update(`signup:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`)
    .digest('hex');

/** Is this signup code usable right now (not expired, revoked or used up)? */
export async function signupCodeValid(code: string): Promise<boolean> {
  if (code.length < 6 || code.length > 64) return false;
  const [r] = await withoutTenant((tx) =>
    tx.execute<{ ok: boolean }>(sql`select platform.signup_code_valid(${hashSignupCode(code)}) as ok`),
  );
  return r?.ok === true;
}

export const SignUpOrganizationInput = CreateOrganizationInput.extend({
  code: z.string().trim().min(6).max(64),
  /** Click-wrap: the platform's current Terms of Service and DPA. */
  acceptTerms: z.literal(true),
});

/**
 * Invite-only signup (M1.3): a signed-in person with a valid signup code creates an organization
 * and becomes its owner, accepting the platform terms in the same transaction. One code use is
 * claimed atomically; a failed signup (e.g. a taken address) gives the use back (rollback).
 */
export const signUpOrganizationCommand = tenantCommand({
  name: 'tenancy.signUpOrganization',
  input: SignUpOrganizationInput,
  output: OrganizationDto,
  entitlement: null,
  permission: 'platform:org.create',
  handler: async ({ input, ctx, tx, emit }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Sign in to create an organization');
    const [claim] = await tx.execute<{ ok: boolean }>(
      sql`select platform.claim_signup_code(${hashSignupCode(input.code)}) as ok`,
    );
    if (!claim?.ok)
      throw new DomainError('validation_failed', 'This signup code is not valid', {
        field: 'code',
        reason: 'invalid_code',
      });
    const { code: _code, acceptTerms: _terms, ...org } = input;
    const row = await insertOrganizationTx(tx, ctx, org, emit);
    for (const document of AGREEMENT_DOCUMENTS)
      await tx.insert(agreementAcceptances).values({
        orgId: row.id,
        document,
        version: PLATFORM_AGREEMENTS[document].version,
        acceptedBy: ctx.actor.userId,
        acceptedAt: ctx.now,
      });
    return row;
  },
  audit: (_input, row) => ({ action: 'organization.signup', targetType: 'organization', targetId: row.id }),
});

/** Sign up an organization (allocates the new org id as the tenant context, like createOrganization). */
export function signUpOrganization(ctx: Ctx, input: unknown, ports: CommandPorts<TenantTx>) {
  const orgId = uuidv7(ctx.now.getTime());
  return executeCommand(signUpOrganizationCommand, input, { ...ctx, orgId }, ports);
}

export const createOrganizationCommand = tenantCommand({
  name: 'tenancy.createOrganization',
  input: CreateOrganizationInput,
  output: OrganizationDto,
  entitlement: null,
  permission: 'platform:org.create',
  handler: ({ input, ctx, tx, emit }) => insertOrganizationTx(tx, ctx, input, emit),
  audit: (_input, row) => ({ action: 'organization.create', targetType: 'organization', targetId: row.id }),
});

/**
 * Create an organization. The new org's id is allocated here and becomes the tenant context,
 * so the org row and its owner membership are written under that org's RLS.
 */
export function createOrganization(ctx: Ctx, input: unknown, ports: CommandPorts<TenantTx>) {
  const orgId = uuidv7(ctx.now.getTime());
  return executeCommand(createOrganizationCommand, input, { ...ctx, orgId }, ports);
}

export const updateOrganizationCommand = tenantCommand({
  name: 'tenancy.updateOrganization',
  input: UpdateOrganizationInput,
  output: OrganizationDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) => {
    const id = requireOrg(ctx);
    const [row] = await tx
      .update(organizations)
      .set({ ...input, updatedAt: ctx.now })
      .where(eq(organizations.id, id))
      .returning();
    if (!row) throw new DomainError('not_found');
    emit({
      type: 'organization.updated',
      version: 1,
      aggregateType: 'organization',
      aggregateId: id,
      payload: { orgId: id, fields: Object.keys(input) },
    });
    return row;
  },
  audit: (input, row) => ({
    action: 'organization.update',
    targetType: 'organization',
    targetId: row.id,
    data: { fields: Object.keys(input) },
  }),
});
