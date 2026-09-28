import { createHash, randomBytes } from 'node:crypto';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type OrgRole, roleCan } from '../domain/permissions.ts';
import { API_KEY_SCOPES, type ApiKeyScope, apiKeys, memberships } from '../schema.ts';

/** `yy_live_` + 32 random bytes (base64url). Test keys (`yy_test_`, a linked sandbox org) come later. */
export const API_KEY_PATTERN = /^yy_live_[A-Za-z0-9_-]{43}$/;
const PREFIX_LENGTH = 12;

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

export const ApiKeyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});
export type ApiKeyDto = z.infer<typeof ApiKeyDto>;

export const CreateApiKeyInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .max(API_KEY_SCOPES.length)
    .transform((s) => [...new Set(s)]),
});

async function roleInTx(tx: TenantTx, ctx: Ctx): Promise<OrgRole | null> {
  if (ctx.actor.type !== 'user') return null;
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, requireOrg(ctx)), eq(memberships.userId, ctx.actor.userId)));
  return (m?.role as OrgRole | undefined) ?? null;
}

export const createApiKeyCommand = tenantCommand({
  name: 'tenancy.createApiKey',
  input: CreateApiKeyInput,
  // The key is returned exactly once; only its hash is stored.
  output: ApiKeyDto.extend({ key: z.string() }),
  entitlement: 'core',
  permission: 'api_keys:manage',
  // Step-up (roadmap §10): a key is standing access to the org's data.
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    // A key never carries more than its creator holds.
    const role = await roleInTx(tx, ctx);
    const beyond = input.scopes.filter((s) => !role || !roleCan(role, s));
    if (beyond.length > 0) {
      throw new DomainError('forbidden', 'A key cannot have scopes beyond your role', {
        reason: 'scope_exceeds_role',
        scopes: beyond,
      });
    }
    const key = `yy_live_${randomBytes(32).toString('base64url')}`;
    const [row] = await tx
      .insert(apiKeys)
      .values({
        orgId: requireOrg(ctx),
        name: input.name,
        prefix: key.slice(0, PREFIX_LENGTH),
        keyHash: hashApiKey(key),
        scopes: input.scopes,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return { ...row, scopes: row.scopes as ApiKeyScope[], key };
  },
  audit: (input, r) => ({
    action: 'apiKey.create',
    targetType: 'api_key',
    targetId: r.id,
    data: { name: input.name, scopes: input.scopes },
  }),
});

export const revokeApiKeyCommand = tenantCommand({
  name: 'tenancy.revokeApiKey',
  input: z.object({ apiKeyId: z.uuid() }),
  output: ApiKeyDto,
  entitlement: 'core',
  permission: 'api_keys:manage',
  // Step-up (roadmap §10): API keys are managed only by someone who just proved it's them.
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const [current] = await tx.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId));
    if (!current) throw new DomainError('not_found', 'API key not found');
    if (current.revokedAt) return { ...current, scopes: current.scopes as ApiKeyScope[] };
    const [row] = await tx
      .update(apiKeys)
      .set({
        revokedAt: ctx.now,
        revokedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(eq(apiKeys.id, current.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return { ...row, scopes: row.scopes as ApiKeyScope[] };
  },
  audit: (input) => ({ action: 'apiKey.revoke', targetType: 'api_key', targetId: input.apiKeyId }),
});

export const listApiKeysQuery = tenantQuery({
  name: 'tenancy.listApiKeys',
  input: z.object({}),
  output: z.array(ApiKeyDto),
  entitlement: 'core',
  permission: 'api_keys:manage',
  handler: async ({ tx }) =>
    (
      await tx.select().from(apiKeys).orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt))
    ).map((r) => ({ ...r, scopes: r.scopes as ApiKeyScope[] })),
});

export interface ApiKeyIdentity {
  readonly orgId: string;
  readonly keyId: string;
  readonly scopes: readonly ApiKeyScope[];
}

/**
 * An API key → (org, key, scopes), before any tenant is known. The org comes from the key,
 * never from a header. Usage is stamped at most once a minute.
 */
export async function apiKeyIdentity(key: string): Promise<ApiKeyIdentity | null> {
  if (!API_KEY_PATTERN.test(key)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; key_id: string; scopes: string[] }>(
      sql`select org_id, key_id, scopes from tenancy.api_key_by_hash(${hashApiKey(key)})`,
    ),
  );
  const r = rows[0];
  if (!r) return null;
  const ctx = createCtx({ orgId: r.org_id, actor: { type: 'system', name: 'api-key-usage' } });
  await withTenant(ctx, (tx) =>
    tx
      .update(apiKeys)
      .set({ lastUsedAt: ctx.now })
      .where(
        and(
          eq(apiKeys.id, r.key_id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(ctx.now.getTime() - 60_000))),
        ),
      ),
  );
  return { orgId: r.org_id, keyId: r.key_id, scopes: r.scopes as ApiKeyScope[] };
}

/** The live scopes of a key in the context org (revoked keys have none). */
export async function apiKeyScopes(ctx: Ctx, keyId: string): Promise<readonly string[]> {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ scopes: apiKeys.scopes })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt))),
  );
  return row?.scopes ?? [];
}
