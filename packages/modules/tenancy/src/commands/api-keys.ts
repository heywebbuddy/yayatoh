import { createHash, randomBytes } from 'node:crypto';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type OrgRole, roleCan } from '../domain/permissions.ts';
import { API_KEY_SCOPES, type ApiKeyScope, apiKeys, memberships, TEST_KEY_SCOPES } from '../schema.ts';

/**
 * `yy_live_` (or `yy_test_` for a test key) + 32 random bytes (base64url). The prefix is part of
 * the hashed secret, so a caller cannot turn a test key into a live one or back.
 */
export const API_KEY_PATTERN = /^yy_(live|test)_[A-Za-z0-9_-]{43}$/;
export const API_KEY_MODES = ['live', 'test'] as const;
export type ApiKeyMode = (typeof API_KEY_MODES)[number];
const PREFIX_LENGTH = 12;

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

export const ApiKeyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  /** A test key (`yy_test_…`): read-only, non-personal scopes (`TEST_KEY_SCOPES`). */
  sandbox: z.boolean(),
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
  /** `test` makes a `yy_test_` key limited to `TEST_KEY_SCOPES`. */
  mode: z.enum(API_KEY_MODES).default('live'),
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
    const sandbox = input.mode === 'test';
    const notForTest = sandbox ? input.scopes.filter((s) => !isTestKeyScope(s)) : [];
    if (notForTest.length > 0) {
      throw new DomainError('validation_failed', 'A test key is read-only without personal data', {
        issues: [{ path: 'scopes', code: 'test_key_scope' }],
        reason: 'test_key_scope',
        scopes: notForTest,
      });
    }
    const key = `yy_${input.mode}_${randomBytes(32).toString('base64url')}`;
    const [row] = await tx
      .insert(apiKeys)
      .values({
        orgId: requireOrg(ctx),
        name: input.name,
        prefix: key.slice(0, PREFIX_LENGTH),
        keyHash: hashApiKey(key),
        scopes: input.scopes,
        sandbox,
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
    data: { name: input.name, scopes: input.scopes, mode: input.mode },
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

const isTestKeyScope = (s: string) => (TEST_KEY_SCOPES as readonly string[]).includes(s);

export interface ApiKeyIdentity {
  readonly orgId: string;
  readonly keyId: string;
  readonly scopes: readonly ApiKeyScope[];
  /** A test key (`yy_test_…`). */
  readonly sandbox: boolean;
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
  const sandbox = key.startsWith('yy_test_');
  const scopes = (r.scopes as ApiKeyScope[]).filter((s) => !sandbox || isTestKeyScope(s));
  return { orgId: r.org_id, keyId: r.key_id, scopes, sandbox };
}

/**
 * The live scopes of a key in the context org (revoked keys have none). A test key never gets
 * more than `TEST_KEY_SCOPES`, whatever its row says (the table CHECK says the same).
 */
export async function apiKeyScopes(ctx: Ctx, keyId: string): Promise<readonly string[]> {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ scopes: apiKeys.scopes, sandbox: apiKeys.sandbox })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt))),
  );
  if (!row) return [];
  return row.sandbox ? row.scopes.filter(isTestKeyScope) : row.scopes;
}
