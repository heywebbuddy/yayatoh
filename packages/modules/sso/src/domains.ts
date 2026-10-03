import { randomBytes } from 'node:crypto';
import { isUniqueViolation } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ssoRuntime } from './config.ts';
import { DomainDto, domainDto } from './connections.ts';
import { normalizeDomain, txtMatches, verificationRecord } from './domain/domains.ts';
import { connections, domains } from './schema.ts';

/** Domains per org (pending owner; enterprises rarely have more than a handful of mail domains). */
export const MAX_DOMAINS = 20;

const DomainInput = z.object({
  domain: z
    .string()
    .max(320)
    .transform((d, c) => {
      const n = normalizeDomain(d);
      if (!n) {
        c.addIssue({ code: 'custom', message: 'invalid_domain' });
        return z.NEVER;
      }
      return n;
    }),
});

/** Claim an email domain: it gets a TXT record to publish. Nothing changes until it is verified. */
export const addDomainCommand = tenantCommand({
  name: 'sso.addDomain',
  input: DomainInput,
  output: DomainDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  handler: async ({ input, ctx, tx }) => {
    const [n] = await tx.select({ n: count() }).from(domains);
    if ((n?.n ?? 0) >= MAX_DOMAINS)
      throw new DomainError('invalid_state', 'Too many domains', { reason: 'domain_limit' });
    try {
      const [row] = await tx
        .insert(domains)
        .values({
          orgId: requireOrg(ctx),
          domain: input.domain,
          token: randomBytes(24).toString('base64url'),
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return row;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'This domain is already listed', {
          issues: [{ path: 'domain', code: 'already_added' }],
          reason: 'already_added',
        });
      throw err;
    }
  },
  present: domainDto,
  audit: (input, r) => ({
    action: 'sso.domain.add',
    targetType: 'sso_domain',
    targetId: r.id,
    data: { domain: input.domain },
  }),
});

/**
 * Look the TXT record up (through the resolver port) and record the answer. A domain verified by
 * another org can't be verified here (`claimed_elsewhere`); a verified domain whose record is gone
 * stays verified until it is removed (re-checks are for pending and failed domains).
 */
export const checkDomainCommand = tenantCommand({
  name: 'sso.checkDomain',
  input: z.object({ domainId: z.uuid() }),
  output: DomainDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx.select().from(domains).where(eq(domains.id, input.domainId)).for('update');
    if (!row) throw new DomainError('not_found');
    if (row.status === 'verified') return row;
    let records: string[][] = [];
    let lookupFailed = false;
    try {
      records = await ssoRuntime().resolveTxt(verificationRecord(row.domain, row.token).name);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      lookupFailed = code !== 'ENODATA' && code !== 'ENOTFOUND';
    }
    const found = txtMatches(records, row.token);
    const failure = found ? null : lookupFailed ? 'lookup_failed' : 'record_not_found';
    try {
      // A savepoint: the global "verified once" index may refuse, and the check is still recorded.
      const [updated] = await tx.transaction(async (sp) =>
        sp
          .update(domains)
          .set({
            status: found ? 'verified' : 'failed',
            lastCheckedAt: ctx.now,
            verifiedAt: found ? ctx.now : null,
            failureReason: failure,
            updatedAt: ctx.now,
          })
          .where(eq(domains.id, row.id))
          .returning(),
      );
      if (!updated) throw new DomainError('internal');
      return updated;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [updated] = await tx
        .update(domains)
        .set({
          status: 'failed',
          lastCheckedAt: ctx.now,
          failureReason: 'claimed_elsewhere',
          updatedAt: ctx.now,
        })
        .where(eq(domains.id, row.id))
        .returning();
      if (!updated) throw new DomainError('internal');
      return updated;
    }
  },
  present: domainDto,
  audit: (_input, r) => ({
    action: 'sso.domain.check',
    targetType: 'sso_domain',
    targetId: r.id,
    data: { domain: r.domain, status: r.status, reason: r.failureReason },
  }),
});

/** Remove a domain (its enforcement ends with it). */
export const removeDomainCommand = tenantCommand({
  name: 'sso.removeDomain',
  category: 'delete',
  input: z.object({ domainId: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ input, tx }) => {
    const [row] = await tx.delete(domains).where(eq(domains.id, input.domainId)).returning();
    if (!row) throw new DomainError('not_found');
    return { id: row.id, domain: row.domain };
  },
  audit: (_input, r) => ({
    action: 'sso.domain.remove',
    targetType: 'sso_domain',
    targetId: r.id,
    data: { domain: (r as { domain?: string }).domain },
  }),
});

/**
 * Require single sign-on for members whose address is in a verified domain: they open this org's
 * console only with a session from its IdP (owners keep every way in, so a broken IdP never locks
 * the org out). Needs an active connection.
 */
export const setDomainEnforcementCommand = tenantCommand({
  name: 'sso.setDomainEnforcement',
  input: z.object({ domainId: z.uuid(), enforced: z.boolean() }),
  output: DomainDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx.select().from(domains).where(eq(domains.id, input.domainId)).for('update');
    if (!row) throw new DomainError('not_found');
    if (input.enforced) {
      if (row.status !== 'verified')
        throw new DomainError('invalid_state', 'Verify the domain first', { reason: 'domain_not_verified' });
      const [conn] = await tx.select({ status: connections.status }).from(connections);
      if (conn?.status !== 'active')
        throw new DomainError('invalid_state', 'Activate single sign-on first', {
          reason: 'connection_inactive',
        });
    }
    const [updated] = await tx
      .update(domains)
      .set({ enforced: input.enforced, updatedAt: ctx.now })
      .where(eq(domains.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return updated;
  },
  present: domainDto,
  audit: (input, r) => ({
    action: input.enforced ? 'sso.domain.enforce' : 'sso.domain.unenforce',
    targetType: 'sso_domain',
    targetId: r.id,
    data: { domain: r.domain },
  }),
});
