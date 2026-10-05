import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { ssoRuntime } from './config.ts';
import {
  certificateInfo,
  IdpConfig,
  METADATA_ERRORS,
  OidcConfig,
  parseSamlMetadata,
  SamlConfig,
} from './domain/config.ts';
import { verificationRecord } from './domain/domains.ts';
import type { CheckRefusal, SsoConnectionView } from './ports.ts';
import {
  CONNECTION_STATUSES,
  connections,
  DOMAIN_STATUSES,
  domains,
  SSO_PROTOCOLS,
  SSO_ROLES,
  scimGroupMembers,
  scimGroups,
  scimTokens,
  scimUsers,
} from './schema.ts';

type ConnectionRow = typeof connections.$inferSelect;

export const ConnectionDto = z.object({
  id: z.uuid(),
  protocol: z.enum(SSO_PROTOCOLS),
  name: z.string(),
  status: z.enum(CONNECTION_STATUSES),
  defaultRole: z.enum(SSO_ROLES),
  jit: z.boolean(),
  saml: z
    .object({
      entityId: z.string(),
      ssoUrl: z.string(),
      metadataUrl: z.string().nullable(),
      certificateSubject: z.string().nullable(),
      certificateExpires: z.date().nullable(),
      certificateFingerprint: z.string().nullable(),
    })
    .nullable(),
  oidc: z.object({ issuer: z.string(), clientId: z.string(), hasSecret: z.boolean() }).nullable(),
  /** A test sign-in passed with the current settings: the connection may be activated. */
  testPassed: z.boolean(),
  testedAt: z.date().nullable(),
  lastTestOk: z.boolean().nullable(),
  lastTestReason: z.string().nullable(),
  createdAt: z.date(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;

export const testPassed = (r: Pick<ConnectionRow, 'testedAt' | 'lastTestOk' | 'configChangedAt'>) =>
  Boolean(r.lastTestOk && r.testedAt && r.testedAt >= r.configChangedAt);

export function connectionDto(r: ConnectionRow): ConnectionDto {
  const cfg = IdpConfig.parse(r.idpConfig);
  const cert = cfg.protocol === 'saml' ? certificateInfo(cfg.certificate) : null;
  return ConnectionDto.parse({
    id: r.id,
    protocol: r.protocol,
    name: r.name,
    status: r.status,
    defaultRole: r.defaultRole,
    jit: r.jit,
    saml:
      cfg.protocol === 'saml'
        ? {
            entityId: cfg.entityId,
            ssoUrl: cfg.ssoUrl,
            metadataUrl: cfg.metadataUrl,
            certificateSubject: cert?.subject ?? null,
            certificateExpires: cert?.validTo ?? null,
            certificateFingerprint: cert?.fingerprint ?? null,
          }
        : null,
    oidc:
      cfg.protocol === 'oidc'
        ? { issuer: cfg.issuer, clientId: cfg.clientId, hasSecret: Boolean(r.clientSecretSealed) }
        : null,
    testPassed: testPassed(r),
    testedAt: r.testedAt,
    lastTestOk: r.lastTestOk,
    lastTestReason: r.lastTestReason,
    createdAt: r.createdAt,
  });
}

const Common = {
  name: z.string().trim().min(1).max(80),
  defaultRole: z.enum(SSO_ROLES).default('viewer'),
  jit: z.boolean().default(true),
};

/** SAML: either the IdP's metadata (XML pasted/uploaded, or a URL) or the three values by hand. */
export const SaveSamlInput = z.object({
  protocol: z.literal('saml'),
  ...Common,
  metadataXml: z.string().max(200_000).nullable().default(null),
  metadataUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable()
    .default(null),
  entityId: z.string().trim().max(1024).nullable().default(null),
  ssoUrl: z.string().trim().max(2048).nullable().default(null),
  certificate: z.string().trim().max(20_000).nullable().default(null),
});

export const SaveOidcInput = z.object({
  protocol: z.literal('oidc'),
  ...Common,
  issuer: z.string().trim().max(2048),
  clientId: z.string().trim().max(255),
  /** Required for a new OIDC connection; empty keeps the stored one. */
  clientSecret: z.string().trim().max(1000).nullable().default(null),
});

export const SaveConnectionInput = z.discriminatedUnion('protocol', [SaveSamlInput, SaveOidcInput]);
export type SaveConnectionInput = z.input<typeof SaveConnectionInput>;

const invalid = (field: string, code: string, reason?: string) =>
  new DomainError('validation_failed', 'The connection settings are not valid', {
    issues: [{ path: field, code }],
    ...(reason ? { reason } : {}),
  });

async function samlConfigOf(input: z.infer<typeof SaveSamlInput>): Promise<SamlConfig> {
  let source: { entityId: string | null; ssoUrl: string | null; certificate: string | null } = input;
  if (input.metadataXml?.trim() || input.metadataUrl) {
    let xml = input.metadataXml?.trim() ?? '';
    if (!xml && input.metadataUrl) {
      try {
        xml = await ssoRuntime().fetchMetadata(input.metadataUrl);
      } catch {
        throw invalid('metadataUrl', 'unreachable', 'metadata_unreachable');
      }
    }
    const parsed = parseSamlMetadata(xml);
    if ('error' in parsed)
      throw invalid(input.metadataXml?.trim() ? 'metadataXml' : 'metadataUrl', parsed.error, parsed.error);
    source = parsed;
  }
  const r = SamlConfig.safeParse({
    protocol: 'saml',
    entityId: source.entityId ?? '',
    ssoUrl: source.ssoUrl ?? '',
    certificate: source.certificate ?? '',
    metadataUrl: input.metadataUrl,
  });
  if (!r.success) {
    const field = String(r.error.issues[0]?.path[0] ?? 'entityId');
    throw invalid(field, 'invalid');
  }
  if (!certificateInfo(r.data.certificate))
    throw invalid('certificate', 'certificate_invalid', 'certificate_invalid');
  return r.data;
}

function oidcConfigOf(input: z.infer<typeof SaveOidcInput>): OidcConfig {
  const r = OidcConfig.safeParse({ protocol: 'oidc', issuer: input.issuer, clientId: input.clientId });
  if (!r.success) throw invalid(String(r.error.issues[0]?.path[0] ?? 'issuer'), 'invalid');
  return r.data;
}

/** jsonb reorders keys: compare with sorted keys. */
const canonical = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : JSON.stringify(v ?? null);
const sameConfig = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * Create or change the org's connection. A changed IdP setting (or a new secret) needs a new
 * test sign-in before the connection can be active again: an active connection whose settings
 * changed goes back to draft.
 */
export const saveConnectionCommand = tenantCommand({
  name: 'sso.saveConnection',
  input: SaveConnectionInput,
  output: ConnectionDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  // Who can sign in to the org (roadmap §10: access changes need a fresh re-authentication).
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const config: IdpConfig = input.protocol === 'saml' ? await samlConfigOf(input) : oidcConfigOf(input);
    const [current] = await tx.select().from(connections).for('update');
    if (current && current.protocol !== input.protocol)
      throw new DomainError('conflict', 'Delete the connection to change its protocol', {
        reason: 'protocol_change',
      });
    const secret = input.protocol === 'oidc' && input.clientSecret ? input.clientSecret : null;
    if (input.protocol === 'oidc' && !secret && !current?.clientSecretSealed)
      throw invalid('clientSecret', 'required');
    const sealed = secret ? await keyVault().encrypt(orgId, new TextEncoder().encode(secret)) : null;
    const changed = !current || !sameConfig(current.idpConfig, config) || sealed !== null;
    if (!current) {
      const [row] = await tx
        .insert(connections)
        .values({
          orgId,
          protocol: input.protocol,
          name: input.name,
          idpConfig: config,
          clientSecretSealed: sealed,
          defaultRole: input.defaultRole,
          jit: input.jit,
          configChangedAt: ctx.now,
          createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return { row, changed: true };
    }
    const [row] = await tx
      .update(connections)
      .set({
        name: input.name,
        idpConfig: config,
        ...(sealed ? { clientSecretSealed: sealed } : {}),
        defaultRole: input.defaultRole,
        jit: input.jit,
        ...(changed
          ? { configChangedAt: ctx.now, status: current.status === 'active' ? 'draft' : current.status }
          : {}),
        updatedAt: ctx.now,
      })
      .where(eq(connections.id, current.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return { row, changed };
  },
  present: (r) => connectionDto(r.row),
  audit: (input, r) => ({
    action: 'sso.connection.save',
    targetType: 'sso_connection',
    targetId: r.row.id,
    data: {
      protocol: input.protocol,
      defaultRole: input.defaultRole,
      jit: input.jit,
      settingsChanged: r.changed,
      secretChanged: input.protocol === 'oidc' && Boolean(input.clientSecret),
    },
  }),
});

async function theConnection(tx: TenantTx): Promise<ConnectionRow> {
  const [row] = await tx.select().from(connections).for('update');
  if (!row) throw new DomainError('not_found', 'No single sign-on connection');
  return row;
}

/** The result of a test sign-in (or of the configuration check that precedes it). */
export const recordConnectionTestCommand = tenantCommand({
  name: 'sso.recordConnectionTest',
  input: z.object({
    connectionId: z.uuid(),
    ok: z.boolean(),
    reason: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .nullable()
      .default(null),
  }),
  output: ConnectionDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await theConnection(tx);
    if (row.id !== input.connectionId) throw new DomainError('not_found');
    const [updated] = await tx
      .update(connections)
      .set({
        testedAt: ctx.now,
        lastTestOk: input.ok,
        lastTestReason: input.ok ? null : input.reason,
        updatedAt: ctx.now,
      })
      .where(eq(connections.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return updated;
  },
  present: connectionDto,
  audit: (input, r) => ({
    action: 'sso.connection.test',
    targetType: 'sso_connection',
    targetId: r.id,
    data: { ok: input.ok, reason: input.reason },
  }),
});

/** Activate (after a passed test sign-in, with a verified domain) or disable the connection. */
export const setConnectionStatusCommand = tenantCommand({
  name: 'sso.setConnectionStatus',
  input: z.object({ status: z.enum(['active', 'disabled']) }),
  output: ConnectionDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const row = await theConnection(tx);
    if (input.status === 'active') {
      if (!testPassed(row))
        throw new DomainError('invalid_state', 'Run a successful test sign-in first', {
          reason: 'test_required',
        });
      const [verified] = await tx.select({ n: count() }).from(domains).where(eq(domains.status, 'verified'));
      if (!verified?.n)
        throw new DomainError('invalid_state', 'Verify a domain first', { reason: 'domain_required' });
    } else {
      // Nobody can sign in with a disabled connection, so nothing may require it.
      await tx.update(domains).set({ enforced: false, updatedAt: ctx.now }).where(eq(domains.enforced, true));
    }
    const [updated] = await tx
      .update(connections)
      .set({ status: input.status, updatedAt: ctx.now })
      .where(eq(connections.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return updated;
  },
  present: connectionDto,
  audit: (input, r) => ({
    action: `sso.connection.${input.status === 'active' ? 'activate' : 'disable'}`,
    targetType: 'sso_connection',
    targetId: r.id,
  }),
});

/** Delete the connection: identity links go with it; enforcement ends. SCIM stays. */
export const deleteConnectionCommand = tenantCommand({
  name: 'sso.deleteConnection',
  category: 'delete',
  input: z.object({}),
  output: z.object({ id: z.uuid() }),
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ ctx, tx }) => {
    const row = await theConnection(tx);
    await tx.update(domains).set({ enforced: false, updatedAt: ctx.now }).where(eq(domains.enforced, true));
    await tx.delete(connections).where(eq(connections.id, row.id));
    return { id: row.id };
  },
  audit: (_input, r) => ({ action: 'sso.connection.delete', targetType: 'sso_connection', targetId: r.id }),
});

// ---------------------------------------------------------------------------------------------
// Settings page

export const DomainDto = z.object({
  id: z.uuid(),
  domain: z.string(),
  status: z.enum(DOMAIN_STATUSES),
  enforced: z.boolean(),
  record: z.object({ name: z.string(), value: z.string() }),
  lastCheckedAt: z.date().nullable(),
  verifiedAt: z.date().nullable(),
  failureReason: z.string().nullable(),
});
export type DomainDto = z.infer<typeof DomainDto>;

export const domainDto = (r: typeof domains.$inferSelect): DomainDto =>
  DomainDto.parse({
    id: r.id,
    domain: r.domain,
    status: r.status,
    enforced: r.enforced,
    record: verificationRecord(r.domain, r.token),
    lastCheckedAt: r.lastCheckedAt,
    verifiedAt: r.verifiedAt,
    failureReason: r.failureReason,
  });

export const SsoSettingsDto = z.object({
  connection: ConnectionDto.nullable(),
  domains: z.array(DomainDto),
  scimToken: z
    .object({ id: z.uuid(), prefix: z.string(), createdAt: z.date(), lastUsedAt: z.date().nullable() })
    .nullable(),
  groups: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      role: z.enum(SSO_ROLES).nullable(),
      members: z.number().int(),
    }),
  ),
  scimUsers: z.object({ active: z.number().int(), deprovisioned: z.number().int() }),
});
export type SsoSettingsDto = z.infer<typeof SsoSettingsDto>;

export const ssoSettingsQuery = tenantQuery({
  name: 'sso.settings',
  input: z.object({}),
  output: SsoSettingsDto,
  entitlement: 'enterprise',
  permission: 'sso:manage',
  handler: async ({ tx }) => {
    const [conn] = await tx.select().from(connections);
    const doms = await tx.select().from(domains).orderBy(asc(domains.domain));
    const [token] = await tx.select().from(scimTokens).where(isNull(scimTokens.revokedAt));
    const groups = await tx
      .select({
        id: scimGroups.id,
        displayName: scimGroups.displayName,
        role: scimGroups.role,
        members: count(scimGroupMembers.id),
      })
      .from(scimGroups)
      .leftJoin(
        scimGroupMembers,
        and(eq(scimGroupMembers.groupId, scimGroups.id), eq(scimGroupMembers.orgId, scimGroups.orgId)),
      )
      .groupBy(scimGroups.id)
      .orderBy(asc(scimGroups.displayName));
    const users = await tx
      .select({ active: scimUsers.active, n: count() })
      .from(scimUsers)
      .groupBy(scimUsers.active);
    return {
      connection: conn ? connectionDto(conn) : null,
      domains: doms.map(domainDto),
      scimToken: token
        ? { id: token.id, prefix: token.prefix, createdAt: token.createdAt, lastUsedAt: token.lastUsedAt }
        : null,
      groups: groups.map((g) => ({ ...g, role: g.role as (typeof SSO_ROLES)[number] | null })),
      scimUsers: {
        active: users.find((u) => u.active)?.n ?? 0,
        deprovisioned: users.find((u) => !u.active)?.n ?? 0,
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------
// For the sign-in flow (server only)

/** The org's connection for the IdP adapter, with its secret opened. Null when there is none. */
export async function connectionView(
  orgId: string,
  connectionId: string,
): Promise<(SsoConnectionView & { status: ConnectionRow['status']; jit: boolean }) | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'sso.login' } });
  const row = await withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    return r ?? null;
  });
  if (!row) return null;
  const secret = row.clientSecretSealed
    ? new TextDecoder().decode(await keyVault().decrypt(orgId, row.clientSecretSealed))
    : null;
  return {
    id: row.id,
    orgId,
    protocol: row.protocol as SsoConnectionView['protocol'],
    config: IdpConfig.parse(row.idpConfig),
    clientSecret: secret,
    status: row.status as ConnectionRow['status'],
    jit: row.jit,
  };
}

/** The configuration check before a test sign-in (certificate, discovery). */
export async function checkConnection(
  view: SsoConnectionView,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: CheckRefusal | 'sso_unavailable' }> {
  const idp = ssoRuntime().idp;
  if (!idp) return { ok: false, reason: 'sso_unavailable' };
  return idp.check(view, now);
}

export { METADATA_ERRORS };
