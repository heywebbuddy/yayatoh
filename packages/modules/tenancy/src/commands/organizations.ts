import { createHash, randomBytes } from 'node:crypto';
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
import { type PlatformFlag, tenantCommand } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AGREEMENT_DOCUMENTS, PLATFORM_AGREEMENTS } from '../domain/agreements.ts';
import { initialOrgStatus, type SignupMode, signupPath } from '../domain/onboarding.ts';
import { CreateOrganizationInput, OrganizationDto, UpdateOrganizationInput } from '../dto.ts';
import { agreementAcceptances, memberships, organizations } from '../schema.ts';
import { ensureManagedDomainTx } from './domains.ts';
import { markOnboardingStepTx, startOnboardingTx } from './onboarding.ts';

type Emit = (e: DomainEvent) => void;

/**
 * The org row (id = the context's new org id), its onboarding progress (M3.11a) and, for a
 * person, their owner membership. Self-serve (`open`) orgs start `limited`.
 */
async function insertOrganizationTx(
  tx: TenantTx,
  ctx: Ctx,
  input: z.output<typeof CreateOrganizationInput>,
  emit: Emit,
  mode: SignupMode = 'direct',
) {
  const id = requireOrg(ctx);
  let row: typeof organizations.$inferSelect | undefined;
  try {
    [row] = await tx
      .insert(organizations)
      .values({ id, orgId: id, ...input, status: initialOrgStatus(mode) })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, 'organizations_slug_key')) {
      throw new DomainError('conflict', 'This address is already taken', { field: 'slug' });
    }
    throw err;
  }
  if (!row) throw new DomainError('internal');
  await startOnboardingTx(tx, id, mode, ctx.now);
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

const SIGNUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A human-friendly signup code, e.g. YY-7KQ4-M2XR-P9TD (12 characters of 31: ~59 bits). */
export function randomSignupCode(): string {
  const chars: string[] = [];
  // Rejection sampling keeps every character equally likely (256 is not a multiple of 31).
  const limit = 256 - (256 % SIGNUP_ALPHABET.length);
  while (chars.length < 12)
    for (const b of randomBytes(16))
      if (b < limit && chars.length < 12) chars.push(SIGNUP_ALPHABET[b % SIGNUP_ALPHABET.length] as string);
  const c = chars.join('');
  return `YY-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

/** What staff give when they create a code in the console (M1.3f). */
export const NewSignupCodeInput = z.object({
  maxUses: z.coerce.number().int().min(1).max(1000),
  days: z.coerce.number().int().min(1).max(365),
  note: z.string().trim().min(1).max(200),
});

/** Is this signup code usable right now (not expired, revoked or used up)? */
export async function signupCodeValid(code: string): Promise<boolean> {
  if (code.length < 6 || code.length > 64) return false;
  const [r] = await withoutTenant((tx) =>
    tx.execute<{ ok: boolean }>(sql`select platform.signup_code_valid(${hashSignupCode(code)}) as ok`),
  );
  return r?.ok === true;
}

/** Is a platform switch on (M3.11a)? Read through the SECURITY DEFINER `platform.flag_enabled`. */
export async function platformFlagTx(tx: TenantTx, key: PlatformFlag): Promise<boolean> {
  const [r] = await tx.execute<{ on: boolean }>(sql`select platform.flag_enabled(${key}) as on`);
  return r?.on === true;
}

/** Is open self-serve signup switched on (M3.11a; staff console, default off)? */
export function openSignupEnabled(): Promise<boolean> {
  return withoutTenant((tx) => platformFlagTx(tx, 'open_signup'));
}

export const SignUpOrganizationInput = CreateOrganizationInput.extend({
  /** An invitation code; optional only while open signup is on (M3.11a). */
  code: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(6).max(64).optional(),
  ),
  /** Click-wrap: the platform's current Terms of Service and DPA. */
  acceptTerms: z.literal(true),
});

/**
 * Signup (M1.3 invite-only; M3.11a self-serve). A signed-in person (an account proves its email
 * address with a one-time code) creates an organization and becomes its owner, accepting the
 * platform terms in the same transaction.
 * - With a code: one use is claimed atomically; a failed signup (e.g. a taken address) gives the
 *   use back (rollback). The org starts `active`.
 * - Without a code: only while staff have switched open signup on, read inside this transaction
 *   (closed → `forbidden` / `signup_closed`). The org starts `limited` until onboarding is done.
 */
export const signUpOrganizationCommand = tenantCommand({
  name: 'tenancy.signUpOrganization',
  input: SignUpOrganizationInput,
  output: OrganizationDto,
  entitlement: null,
  permission: 'platform:org.create',
  handler: async ({ input, ctx, tx, emit }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Sign in to create an organization');
    const path = signupPath({
      code: input.code,
      openSignup: input.code ? false : await platformFlagTx(tx, 'open_signup'),
    });
    if (path === 'closed')
      throw new DomainError('forbidden', 'Signup is by invitation only for now', {
        field: 'code',
        reason: 'signup_closed',
      });
    if (path === 'code') {
      const [claim] = await tx.execute<{ ok: boolean }>(
        sql`select platform.claim_signup_code(${hashSignupCode(input.code ?? '')}) as ok`,
      );
      if (!claim?.ok)
        throw new DomainError('validation_failed', 'This signup code is not valid', {
          field: 'code',
          reason: 'invalid_code',
        });
    }
    const { code: _code, acceptTerms: _terms, ...org } = input;
    const row = await insertOrganizationTx(tx, ctx, org, emit, path);
    await markOnboardingStepTx(tx, 'terms', ctx.now);
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
  audit: (input, row) => ({
    action: 'organization.signup',
    targetType: 'organization',
    targetId: row.id,
    data: { mode: input.code ? 'code' : 'open', status: row.status },
  }),
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
    if (input.brandColor) await markOnboardingStepTx(tx, 'brand', ctx.now);
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
