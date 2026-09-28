import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { managedHostname, normalizeHostname, reservedHostname } from '../hosting/hostnames.ts';
import { DOMAIN_KINDS, DOMAIN_STATUSES, organizations, orgDomains } from '../schema.ts';

/** Custom domains per org (the managed subdomain is not counted). */
export const MAX_CUSTOM_DOMAINS = 10;

const DnsRecordDto = z.object({
  type: z.enum(['A', 'CNAME', 'TXT']),
  name: z.string().max(300),
  value: z.string().max(500),
});

export const DomainDto = z.object({
  id: z.uuid(),
  hostname: z.string(),
  kind: z.enum(DOMAIN_KINDS),
  managed: z.boolean(),
  isPrimary: z.boolean(),
  status: z.enum(DOMAIN_STATUSES),
  records: z.array(DnsRecordDto),
  sslStatus: z.enum(['pending', 'issued']).nullable(),
  /** Apple Pay / Google Pay registered for this host (Payment Method Domains). */
  walletsReady: z.boolean(),
  failureReason: z.string().nullable(),
  lastCheckedAt: z.date().nullable(),
});
export type DomainDto = z.infer<typeof DomainDto>;

type Row = typeof orgDomains.$inferSelect;
const present = (r: Row): DomainDto =>
  DomainDto.parse({
    id: r.id,
    hostname: r.hostname,
    kind: r.kind,
    managed: r.managed,
    isPrimary: r.isPrimary,
    status: r.status,
    records: r.records,
    sslStatus: r.sslStatus,
    walletsReady: r.paymentMethodDomainId !== null,
    failureReason: r.failureReason,
    lastCheckedAt: r.lastCheckedAt,
  });

async function loadDomainTx(tx: TenantTx, id: string): Promise<Row> {
  const [r] = await tx.select().from(orgDomains).where(eq(orgDomains.id, id)).for('update');
  if (!r) throw new DomainError('not_found', 'Domain not found');
  return r;
}

/** Create the managed tenant-apex subdomain (idempotent). Runs with org creation. */
export async function ensureManagedDomainTx(tx: TenantTx, ctx: Ctx, slug: string): Promise<Row> {
  const orgId = requireOrg(ctx);
  const [mine] = await tx.select().from(orgDomains).where(eq(orgDomains.managed, true));
  if (mine) return mine;
  const [anyPrimary] = await tx
    .select({ id: orgDomains.id })
    .from(orgDomains)
    .where(eq(orgDomains.isPrimary, true));
  const [row] = await tx
    .insert(orgDomains)
    .values({
      orgId,
      hostname: managedHostname(slug),
      managed: true,
      status: 'active',
      sslStatus: 'issued',
      isPrimary: !anyPrimary,
      activatedAt: ctx.now,
    })
    .returning();
  if (!row) throw new DomainError('internal');
  return row;
}

export const listDomainsQuery = tenantQuery({
  name: 'tenancy.listDomains',
  input: z.object({}),
  output: z.array(DomainDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) =>
    (
      await tx.select().from(orgDomains).orderBy(sql`${orgDomains.managed} desc`, asc(orgDomains.createdAt))
    ).map(present),
});

/** The managed subdomain for orgs created before domains existed (the Domains page offers it). */
export const ensureManagedDomainCommand = tenantCommand({
  name: 'tenancy.ensureManagedDomain',
  input: z.object({}),
  output: DomainDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ ctx, tx }) => {
    const [o] = await tx.select({ slug: organizations.slug }).from(organizations);
    if (!o) throw new DomainError('not_found');
    return present(await ensureManagedDomainTx(tx, ctx, o.slug));
  },
  audit: (_i, r) => ({ action: 'domain.ensure_managed', targetType: 'domain', targetId: r.id }),
});

/**
 * Add a custom domain. It starts waiting for DNS; the web asks the hosting provider to add it
 * (outside the transaction) and records the DNS records to publish.
 */
export const addDomainCommand = tenantCommand({
  name: 'tenancy.addDomain',
  input: z.object({ hostname: z.string().max(300) }),
  output: DomainDto,
  entitlement: 'core',
  permission: 'org:update',
  // Step-up (roadmap §10): domains decide where buyers pay and sign in.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const hostname = normalizeHostname(input.hostname);
    if (!hostname) throw new DomainError('validation_failed', 'Not a domain name', { field: 'hostname' });
    if (reservedHostname(hostname) && ctx.actor.type !== 'system')
      throw new DomainError('forbidden', 'This domain is reserved', {
        field: 'hostname',
        reason: 'reserved',
      });
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orgDomains)
      .where(eq(orgDomains.managed, false));
    if (n >= MAX_CUSTOM_DOMAINS)
      throw new DomainError('invalid_state', 'Too many domains', { reason: 'domain_limit' });
    const [row] = await tx
      .insert(orgDomains)
      .values({ orgId: requireOrg(ctx), hostname })
      .onConflictDoNothing()
      .returning();
    // Held by this org or another one: the same answer (never say whose).
    if (!row) throw new DomainError('conflict', 'This domain is already in use', { field: 'hostname' });
    emit({
      type: 'domain.added',
      version: 1,
      aggregateType: 'domain',
      aggregateId: row.id,
      payload: { orgId: row.orgId, domainId: row.id, hostname },
    });
    return present(row);
  },
  audit: (_i, r) => ({
    action: 'domain.add',
    targetType: 'domain',
    targetId: r?.id ?? null,
    data: { hostname: r?.hostname },
  }),
});

const DomainCheckInput = z.object({
  status: z.enum(DOMAIN_STATUSES),
  records: z.array(DnsRecordDto).max(20),
  sslStatus: z.enum(['pending', 'issued']).nullable(),
  reason: z.string().max(200).nullable(),
});

/**
 * Record what the hosting provider reported for a custom domain. The first time it is active it
 * emits `domain.activated@1` and becomes primary unless another custom domain already is.
 */
async function primaryIdTx(tx: TenantTx, kind: string): Promise<string | null> {
  const [p] = await tx
    .select({ id: orgDomains.id })
    .from(orgDomains)
    .where(and(eq(orgDomains.kind, kind), eq(orgDomains.isPrimary, true)));
  return p?.id ?? null;
}

export const recordDomainCheckCommand = tenantCommand({
  name: 'tenancy.recordDomainCheck',
  input: z.object({
    domainId: z.uuid(),
    providerRef: z.string().max(200).optional(),
    check: DomainCheckInput,
  }),
  output: DomainDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) => {
    const d = await loadDomainTx(tx, input.domainId);
    if (d.managed) throw new DomainError('invalid_state', 'The managed subdomain needs no DNS checks');
    const primaryBefore = await primaryIdTx(tx, d.kind);
    const active = input.check.status === 'active';
    const first = active && d.activatedAt === null;
    let [row] = await tx
      .update(orgDomains)
      .set({
        status: input.check.status,
        records: [...input.check.records],
        sslStatus: input.check.sslStatus,
        failureReason: input.check.reason,
        providerRef: input.providerRef ?? d.providerRef,
        lastCheckedAt: ctx.now,
        activatedAt: first ? ctx.now : d.activatedAt,
        // A primary that stops resolving gives primary back (below).
        isPrimary: d.isPrimary && active,
        updatedAt: ctx.now,
      })
      .where(eq(orgDomains.id, d.id))
      .returning();
    if (!row) throw new DomainError('internal');
    const [primary] = await tx
      .select({ id: orgDomains.id, managed: orgDomains.managed })
      .from(orgDomains)
      .where(eq(orgDomains.isPrimary, true));
    // Roadmap §4.2: a verified custom domain outranks the managed subdomain, so the first custom
    // domain to go live takes over as primary; one that stops resolving hands it back.
    if (first && (!primary || primary.managed)) {
      if (primary) await tx.update(orgDomains).set({ isPrimary: false }).where(eq(orgDomains.id, primary.id));
      const [next] = await tx
        .update(orgDomains)
        .set({ isPrimary: true })
        .where(eq(orgDomains.id, d.id))
        .returning();
      if (next) row = next;
    } else if (!primary) {
      await tx.update(orgDomains).set({ isPrimary: true }).where(eq(orgDomains.managed, true));
    }
    if (first)
      emit({
        type: 'domain.activated',
        version: 1,
        aggregateType: 'domain',
        aggregateId: d.id,
        payload: { orgId: d.orgId, domainId: d.id, hostname: d.hostname },
      });
    const primaryAfter = await primaryIdTx(tx, d.kind);
    if (primaryAfter !== primaryBefore)
      emit({
        type: 'domain.primary_changed',
        version: 1,
        aggregateType: 'domain',
        aggregateId: primaryAfter ?? d.id,
        payload: { orgId: d.orgId, kind: d.kind, domainId: primaryAfter },
      });
    return present(row);
  },
  audit: (input, r) => ({
    action: 'domain.check',
    targetType: 'domain',
    targetId: input.domainId,
    data: { status: r?.status },
  }),
});

/** Record the Payment Method Domain registered for an active host (Apple Pay / Google Pay). */
export const recordDomainWalletsCommand = tenantCommand({
  name: 'tenancy.recordDomainWallets',
  input: z.object({ domainId: z.uuid(), paymentMethodDomainId: z.string().min(3).max(200) }),
  output: DomainDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const d = await loadDomainTx(tx, input.domainId);
    if (d.status !== 'active') throw new DomainError('invalid_state', 'The domain is not active yet');
    const [row] = await tx
      .update(orgDomains)
      .set({ paymentMethodDomainId: input.paymentMethodDomainId, updatedAt: ctx.now })
      .where(eq(orgDomains.id, d.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return present(row);
  },
  audit: (input) => ({ action: 'domain.wallets', targetType: 'domain', targetId: input.domainId }),
});

/** Make an active domain the primary site host; the others redirect to it (M1.11). */
export const setPrimaryDomainCommand = tenantCommand({
  name: 'tenancy.setPrimaryDomain',
  input: z.object({ domainId: z.uuid() }),
  output: DomainDto,
  entitlement: 'core',
  permission: 'org:update',
  // Step-up (roadmap §10): domains decide where buyers pay and sign in.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const d = await loadDomainTx(tx, input.domainId);
    if (d.status !== 'active') throw new DomainError('invalid_state', 'The domain is not active yet');
    if (!d.isPrimary)
      emit({
        type: 'domain.primary_changed',
        version: 1,
        aggregateType: 'domain',
        aggregateId: d.id,
        payload: { orgId: d.orgId, kind: d.kind, domainId: d.id },
      });
    await tx
      .update(orgDomains)
      .set({ isPrimary: false })
      .where(and(eq(orgDomains.kind, d.kind), ne(orgDomains.id, d.id)));
    const [row] = await tx
      .update(orgDomains)
      .set({ isPrimary: true, updatedAt: ctx.now })
      .where(eq(orgDomains.id, d.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return present(row);
  },
  audit: (input) => ({ action: 'domain.set_primary', targetType: 'domain', targetId: input.domainId }),
});

/** Remove a custom domain (frees the hostname); the web then removes it at the provider. */
export const removeDomainCommand = tenantCommand({
  name: 'tenancy.removeDomain',
  category: 'delete',
  input: z.object({ domainId: z.uuid() }),
  output: z.object({ hostname: z.string() }),
  entitlement: 'core',
  permission: 'org:update',
  // Step-up (roadmap §10): domains decide where buyers pay and sign in.
  stepUp: true,
  handler: async ({ input, tx, emit }) => {
    const d = await loadDomainTx(tx, input.domainId);
    if (d.managed) throw new DomainError('invalid_state', 'The managed subdomain cannot be removed');
    await tx.delete(orgDomains).where(eq(orgDomains.id, d.id));
    if (d.isPrimary) await tx.update(orgDomains).set({ isPrimary: true }).where(eq(orgDomains.managed, true));
    emit({
      type: 'domain.removed',
      version: 1,
      aggregateType: 'domain',
      aggregateId: d.id,
      payload: { orgId: d.orgId, domainId: d.id, hostname: d.hostname },
    });
    return { hostname: d.hostname };
  },
  audit: (input, r) => ({
    action: 'domain.remove',
    targetType: 'domain',
    targetId: input.domainId,
    data: { hostname: r?.hostname },
  }),
});

/**
 * Host routing (M1.11): which org serves this hostname, and its primary host (non-primary hosts
 * redirect there). Only active site domains of active or limited orgs resolve.
 */
export async function resolveHost(
  hostname: string,
): Promise<{ orgId: string; primaryHost: string | null } | null> {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; primary_host: string | null }>(
      sql`select org_id, primary_host from tenancy.org_by_host(${host})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, primaryHost: r.primary_host } : null;
}
