import { createHash, randomBytes } from 'node:crypto';
import { isUniqueViolation, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { ensureManagedMembershipTx, removeManagedMembershipTx } from '@yayatoh/tenancy';
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { emailDomain } from './domain/domains.ts';
import { mappedRole } from './domain/roles.ts';
import {
  type GroupFields,
  groupResource,
  listResponse,
  ScimGroupResource,
  ScimUserResource,
  type UserFields,
  userResource,
} from './domain/scim.ts';
import {
  connections,
  domains,
  SSO_ROLES,
  type SsoRole,
  scimGroupMembers,
  scimGroups,
  scimTokens,
  scimUsers,
} from './schema.ts';

// ---------------------------------------------------------------------------------------------
// The org's SCIM token

/** `yy_scim_` + 32 random bytes (base64url). */
export const SCIM_TOKEN_PATTERN = /^yy_scim_[A-Za-z0-9_-]{43}$/;
export const hashScimToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const ScimTokenDto = z.object({ id: z.uuid(), prefix: z.string(), createdAt: z.date() });

/**
 * A new SCIM token, shown once (only its hash is kept). Creating one revokes the live one
 * (rotation): the IdP must be given the new token. Step-up: it is standing access to provisioning.
 */
export const createScimTokenCommand = tenantCommand({
  name: 'sso.createScimToken',
  input: z.object({}),
  output: ScimTokenDto.extend({ token: z.string(), rotated: z.boolean() }),
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ ctx, tx }) => {
    const revoked = await tx
      .update(scimTokens)
      .set({ revokedAt: ctx.now, updatedAt: ctx.now })
      .where(isNull(scimTokens.revokedAt))
      .returning({ id: scimTokens.id });
    const token = `yy_scim_${randomBytes(32).toString('base64url')}`;
    const [row] = await tx
      .insert(scimTokens)
      .values({
        orgId: requireOrg(ctx),
        prefix: token.slice(0, 12),
        tokenHash: hashScimToken(token),
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return { id: row.id, prefix: row.prefix, createdAt: row.createdAt, token, rotated: revoked.length > 0 };
  },
  audit: (_input, r) => ({
    action: r.rotated ? 'sso.scim_token.rotate' : 'sso.scim_token.create',
    targetType: 'scim_token',
    targetId: r.id,
  }),
});

export const revokeScimTokenCommand = tenantCommand({
  name: 'sso.revokeScimToken',
  input: z.object({}),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ ctx, tx }) => {
    const rows = await tx
      .update(scimTokens)
      .set({ revokedAt: ctx.now, updatedAt: ctx.now })
      .where(isNull(scimTokens.revokedAt))
      .returning({ id: scimTokens.id });
    return { revoked: rows.length > 0, id: rows[0]?.id ?? null };
  },
  audit: (_input, r) => ({ action: 'sso.scim_token.revoke', targetType: 'scim_token', targetId: r.id }),
});

/**
 * A SCIM bearer token → its org (the org comes from the token, never from a header), stamping its
 * use at most once a minute. Null for anything that isn't a live token of an active org.
 */
export async function scimTokenIdentity(token: string): Promise<{ orgId: string; tokenId: string } | null> {
  if (!SCIM_TOKEN_PATTERN.test(token)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; token_id: string }>(
      sql`select org_id, token_id from sso.scim_token_by_hash(${hashScimToken(token)})`,
    ),
  );
  const r = rows[0];
  if (!r) return null;
  const ctx = scimCtx(r.org_id, r.token_id);
  await withTenant(ctx, (tx) =>
    tx
      .update(scimTokens)
      .set({ lastUsedAt: ctx.now })
      .where(
        and(
          eq(scimTokens.id, r.token_id),
          or(isNull(scimTokens.lastUsedAt), lt(scimTokens.lastUsedAt, new Date(ctx.now.getTime() - 60_000))),
        ),
      ),
  );
  return { orgId: r.org_id, tokenId: r.token_id };
}

/** The command context of a SCIM request: a system actor named after the token. */
export const scimCtx = (orgId: string, tokenId: string): Ctx =>
  createCtx({ orgId, actor: { type: 'system', name: `scim:${tokenId}` } });

/** Whether SCIM may provision this address in the org (its domain is verified there). */
export async function scimEmailAllowed(ctx: Ctx, email: string): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain) return false;
  return withTenant(ctx, async (tx) => {
    const [d] = await tx
      .select({ id: domains.id })
      .from(domains)
      .where(and(eq(domains.domain, domain), eq(domains.status, 'verified')));
    return Boolean(d);
  });
}

// ---------------------------------------------------------------------------------------------
// Membership sync

type UserRow = typeof scimUsers.$inferSelect;

async function defaultRoleTx(tx: TenantTx): Promise<SsoRole> {
  const [c] = await tx.select({ role: connections.defaultRole }).from(connections);
  return (c?.role as SsoRole | undefined) ?? 'viewer';
}

const scimError = (code: 'not_found' | 'conflict' | 'validation_failed' | 'invalid_state', detail: string, scimType?: string) =>
  new DomainError(code, detail, scimType ? { scimType } : {});

/**
 * Bring the person's membership in line with their SCIM state: an active user is a member (role
 * from their mapped groups, the strongest wins; without a mapped group a new member gets the
 * default role and an existing member keeps theirs); an inactive user is not a member. The org's
 * last owner is never removed (409). Returns whether their sessions must end.
 */
async function syncMembershipTx(
  tx: TenantTx,
  ctx: Ctx,
  user: UserRow,
  emit: (e: { type: string; version: number; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }) => void,
): Promise<{ revoke: boolean }> {
  const orgId = requireOrg(ctx);
  if (!user.active) {
    const r = await removeManagedMembershipTx(tx, { orgId, userId: user.userId });
    if (r === 'last_owner')
      throw new DomainError('invalid_state', 'The organization needs at least one owner', {
        reason: 'last_owner',
        scimType: 'mutability',
      });
    return { revoke: true };
  }
  const roles = await tx
    .select({ role: scimGroups.role })
    .from(scimGroupMembers)
    .innerJoin(scimGroups, and(eq(scimGroups.id, scimGroupMembers.groupId), eq(scimGroups.orgId, scimGroupMembers.orgId)))
    .where(eq(scimGroupMembers.scimUserId, user.id));
  const mapped = mappedRole(roles.map((r) => r.role));
  const r = await ensureManagedMembershipTx(tx, {
    orgId,
    userId: user.userId,
    role: mapped ?? (await defaultRoleTx(tx)),
    manageRole: mapped !== null,
    now: ctx.now,
  });
  if (r.action === 'added')
    emit({
      type: 'membership.added',
      version: 1,
      aggregateType: 'membership',
      aggregateId: r.membershipId,
      payload: { orgId, userId: user.userId, role: r.role },
    });
  return { revoke: false };
}

// ---------------------------------------------------------------------------------------------
// Users

const BaseUrl = z.url().max(500);

async function userGroups(tx: TenantTx, scimUserIds: readonly string[]) {
  if (scimUserIds.length === 0) return new Map<string, { id: string; displayName: string }[]>();
  const rows = await tx
    .select({ userId: scimGroupMembers.scimUserId, id: scimGroups.id, displayName: scimGroups.displayName })
    .from(scimGroupMembers)
    .innerJoin(scimGroups, and(eq(scimGroups.id, scimGroupMembers.groupId), eq(scimGroups.orgId, scimGroupMembers.orgId)))
    .where(inArray(scimGroupMembers.scimUserId, [...scimUserIds]))
    .orderBy(asc(scimGroups.displayName));
  const map = new Map<string, { id: string; displayName: string }[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), { id: r.id, displayName: r.displayName }]);
  return map;
}

async function userResourceTx(tx: TenantTx, row: UserRow, baseUrl: string): Promise<ScimUserResource> {
  const groups = (await userGroups(tx, [row.id])).get(row.id) ?? [];
  return userResource({ ...row, groups }, baseUrl);
}

async function findUser(tx: TenantTx, id: string): Promise<UserRow> {
  const [row] = await tx.select().from(scimUsers).where(eq(scimUsers.id, id)).for('update');
  if (!row) throw scimError('not_found', 'User not found');
  return row;
}

const UserFieldsInput = z.object({
  userName: z.string().min(3).max(320),
  email: z.email().max(320),
  externalId: z.string().max(255).nullable(),
  displayName: z.string().max(200).nullable(),
  givenName: z.string().max(100).nullable(),
  familyName: z.string().max(100).nullable(),
  active: z.boolean(),
}) satisfies z.ZodType<UserFields>;

const UserResult = z.object({ resource: ScimUserResource, revokeUserId: z.uuid().nullable() });

const SCIM = { entitlement: 'enterprise', permission: 'platform:sso.scim' } as const;

/** POST /Users: the account (found or made by the caller) becomes a SCIM user and a member. */
export const scimCreateUserCommand = tenantCommand({
  name: 'sso.scimCreateUser',
  input: z.object({ userId: z.uuid(), fields: UserFieldsInput, baseUrl: BaseUrl }),
  output: UserResult,
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    let row: UserRow | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .insert(scimUsers)
          .values({
            orgId: requireOrg(ctx),
            userId: input.userId,
            ...input.fields,
            deprovisionedAt: input.fields.active ? null : ctx.now,
          })
          .returning(),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw scimError('conflict', 'A user with this userName exists', 'uniqueness');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    const { revoke } = await syncMembershipTx(tx, ctx, row, emit);
    return { resource: await userResourceTx(tx, row, input.baseUrl), revokeUserId: revoke ? row.userId : null };
  },
  audit: (input, r) => ({
    action: 'sso.scim.user.create',
    targetType: 'user',
    targetId: input.userId,
    data: { scimUserId: r.resource.id, active: input.fields.active },
  }),
});

/**
 * PUT / PATCH /Users/{id}: the new state of the user (computed by the caller from the stored one).
 * The address never changes (another address is another account). Turning `active` off
 * deprovisions: the membership ends and the caller ends the person's sessions.
 */
export const scimUpdateUserCommand = tenantCommand({
  name: 'sso.scimUpdateUser',
  input: z.object({ id: z.uuid(), fields: UserFieldsInput, baseUrl: BaseUrl }),
  output: UserResult,
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findUser(tx, input.id);
    if (input.fields.email.toLowerCase() !== current.email.toLowerCase())
      throw scimError('validation_failed', 'The address cannot change to another account', 'mutability');
    let row: UserRow | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .update(scimUsers)
          .set({
            ...input.fields,
            email: current.email,
            deprovisionedAt: input.fields.active ? null : (current.deprovisionedAt ?? ctx.now),
            updatedAt: ctx.now,
          })
          .where(eq(scimUsers.id, current.id))
          .returning(),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw scimError('conflict', 'A user with this userName exists', 'uniqueness');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    const { revoke } = await syncMembershipTx(tx, ctx, row, emit);
    // Sessions end only on the way out (deactivation), not on every update of an inactive user.
    const deprovisioned = current.active && !row.active;
    return {
      resource: await userResourceTx(tx, row, input.baseUrl),
      revokeUserId: revoke && deprovisioned ? row.userId : null,
      deprovisioned,
      reactivated: !current.active && row.active,
    };
  },
  audit: (input, r) => ({
    action: r.deprovisioned
      ? 'sso.scim.user.deprovision'
      : r.reactivated
        ? 'sso.scim.user.reactivate'
        : 'sso.scim.user.update',
    targetType: 'scim_user',
    targetId: input.id,
  }),
});

/** DELETE /Users/{id}: deprovision and forget the SCIM user (the account itself stays). */
export const scimDeleteUserCommand = tenantCommand({
  name: 'sso.scimDeleteUser',
  category: 'delete',
  input: z.object({ id: z.uuid() }),
  output: z.object({ revokeUserId: z.uuid().nullable() }),
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findUser(tx, input.id);
    await syncMembershipTx(tx, ctx, { ...current, active: false }, emit);
    await tx.delete(scimUsers).where(eq(scimUsers.id, current.id));
    return { revokeUserId: current.active ? current.userId : null, userId: current.userId };
  },
  audit: (input, r) => ({
    action: 'sso.scim.user.delete',
    targetType: 'scim_user',
    targetId: input.id,
    data: { userId: (r as { userId: string }).userId },
  }),
});

/** The stored state of a user, for PUT/PATCH (the caller applies the request to it). */
export const scimUserFieldsQuery = tenantQuery({
  name: 'sso.scimUserFields',
  input: z.object({ id: z.uuid() }),
  output: UserFieldsInput.nullable(),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const [r] = await tx.select().from(scimUsers).where(eq(scimUsers.id, input.id));
    return r
      ? {
          userName: r.userName,
          email: r.email,
          externalId: r.externalId,
          displayName: r.displayName,
          givenName: r.givenName,
          familyName: r.familyName,
          active: r.active,
        }
      : null;
  },
});

export const scimGetUserQuery = tenantQuery({
  name: 'sso.scimGetUser',
  input: z.object({ id: z.uuid(), baseUrl: BaseUrl }),
  output: ScimUserResource.nullable(),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const [r] = await tx.select().from(scimUsers).where(eq(scimUsers.id, input.id));
    return r ? userResourceTx(tx, r, input.baseUrl) : null;
  },
});

const ListInput = z.object({
  filter: z.object({ attribute: z.string(), value: z.string() }).nullable(),
  startIndex: z.number().int().min(1),
  count: z.number().int().min(0).max(200),
  baseUrl: BaseUrl,
});

export const scimListUsersQuery = tenantQuery({
  name: 'sso.scimListUsers',
  input: ListInput,
  output: z.object({
    schemas: z.array(z.string()),
    totalResults: z.number().int(),
    startIndex: z.number().int(),
    itemsPerPage: z.number().int(),
    Resources: z.array(ScimUserResource),
  }),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const f = input.filter;
    const where = !f
      ? undefined
      : f.attribute === 'userName'
        ? sql`lower(${scimUsers.userName}) = ${f.value.toLowerCase()}`
        : f.attribute === 'externalId'
          ? eq(scimUsers.externalId, f.value)
          : sql`lower(${scimUsers.email}) = ${f.value.toLowerCase()}`;
    const [total] = await tx.select({ n: count() }).from(scimUsers).where(where);
    const rows = await tx
      .select()
      .from(scimUsers)
      .where(where)
      .orderBy(asc(scimUsers.createdAt), asc(scimUsers.id))
      .limit(input.count)
      .offset(input.startIndex - 1);
    const groups = await userGroups(
      tx,
      rows.map((r) => r.id),
    );
    return listResponse(
      rows.map((r) => userResource({ ...r, groups: groups.get(r.id) ?? [] }, input.baseUrl)),
      total?.n ?? 0,
      input.startIndex,
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Groups

type GroupRow = typeof scimGroups.$inferSelect;

async function groupResourceTx(tx: TenantTx, row: GroupRow, baseUrl: string): Promise<ScimGroupResource> {
  const members = await tx
    .select({ id: scimUsers.id, userName: scimUsers.userName })
    .from(scimGroupMembers)
    .innerJoin(scimUsers, and(eq(scimUsers.id, scimGroupMembers.scimUserId), eq(scimUsers.orgId, scimGroupMembers.orgId)))
    .where(eq(scimGroupMembers.groupId, row.id))
    .orderBy(asc(scimUsers.userName));
  return groupResource({ ...row, members }, baseUrl);
}

const GroupFieldsInput = z.object({
  displayName: z.string().min(1).max(200),
  externalId: z.string().max(255).nullable(),
  members: z.array(z.uuid()).max(1000),
}) satisfies z.ZodType<GroupFields>;

/** Set a group's members and re-sync the people whose groups changed. */
async function setMembersTx(
  tx: TenantTx,
  ctx: Ctx,
  group: GroupRow,
  members: readonly string[],
  emit: Parameters<typeof syncMembershipTx>[3],
) {
  const orgId = requireOrg(ctx);
  const before = (
    await tx.select({ id: scimGroupMembers.scimUserId }).from(scimGroupMembers).where(eq(scimGroupMembers.groupId, group.id))
  ).map((r) => r.id);
  const known =
    members.length === 0
      ? []
      : (await tx.select({ id: scimUsers.id }).from(scimUsers).where(inArray(scimUsers.id, [...members]))).map(
          (r) => r.id,
        );
  if (known.length !== new Set(members).size) throw scimError('validation_failed', 'Unknown member', 'invalidValue');
  const add = known.filter((id) => !before.includes(id));
  const remove = before.filter((id) => !known.includes(id));
  if (remove.length > 0)
    await tx
      .delete(scimGroupMembers)
      .where(and(eq(scimGroupMembers.groupId, group.id), inArray(scimGroupMembers.scimUserId, remove)));
  if (add.length > 0)
    await tx.insert(scimGroupMembers).values(add.map((scimUserId) => ({ orgId, groupId: group.id, scimUserId })));
  if (group.role) await resyncUsersTx(tx, ctx, [...add, ...remove], emit);
}

async function resyncUsersTx(
  tx: TenantTx,
  ctx: Ctx,
  scimUserIds: readonly string[],
  emit: Parameters<typeof syncMembershipTx>[3],
) {
  if (scimUserIds.length === 0) return;
  const users = await tx.select().from(scimUsers).where(inArray(scimUsers.id, [...scimUserIds]));
  for (const u of users) if (u.active) await syncMembershipTx(tx, ctx, u, emit);
}

const GroupResult = z.object({ resource: ScimGroupResource });

export const scimCreateGroupCommand = tenantCommand({
  name: 'sso.scimCreateGroup',
  input: z.object({ fields: GroupFieldsInput, baseUrl: BaseUrl }),
  output: GroupResult,
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    let row: GroupRow | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .insert(scimGroups)
          .values({ orgId: requireOrg(ctx), displayName: input.fields.displayName, externalId: input.fields.externalId })
          .returning(),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw scimError('conflict', 'A group with this name exists', 'uniqueness');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    await setMembersTx(tx, ctx, row, input.fields.members, emit);
    return { resource: await groupResourceTx(tx, row, input.baseUrl) };
  },
  audit: (input, r) => ({
    action: 'sso.scim.group.create',
    targetType: 'scim_group',
    targetId: r.resource.id,
    data: { members: input.fields.members.length },
  }),
});

export const scimUpdateGroupCommand = tenantCommand({
  name: 'sso.scimUpdateGroup',
  input: z.object({ id: z.uuid(), fields: GroupFieldsInput, baseUrl: BaseUrl }),
  output: GroupResult,
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    const [current] = await tx.select().from(scimGroups).where(eq(scimGroups.id, input.id)).for('update');
    if (!current) throw scimError('not_found', 'Group not found');
    let row: GroupRow | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .update(scimGroups)
          .set({ displayName: input.fields.displayName, externalId: input.fields.externalId, updatedAt: ctx.now })
          .where(eq(scimGroups.id, current.id))
          .returning(),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw scimError('conflict', 'A group with this name exists', 'uniqueness');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    await setMembersTx(tx, ctx, row, input.fields.members, emit);
    return { resource: await groupResourceTx(tx, row, input.baseUrl) };
  },
  audit: (input) => ({ action: 'sso.scim.group.update', targetType: 'scim_group', targetId: input.id }),
});

export const scimDeleteGroupCommand = tenantCommand({
  name: 'sso.scimDeleteGroup',
  category: 'delete',
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  ...SCIM,
  handler: async ({ input, ctx, tx, emit }) => {
    const [current] = await tx.select().from(scimGroups).where(eq(scimGroups.id, input.id)).for('update');
    if (!current) throw scimError('not_found', 'Group not found');
    await setMembersTx(tx, ctx, current, [], emit);
    await tx.delete(scimGroups).where(eq(scimGroups.id, current.id));
    return { id: current.id };
  },
  audit: (input) => ({ action: 'sso.scim.group.delete', targetType: 'scim_group', targetId: input.id }),
});

export const scimGroupFieldsQuery = tenantQuery({
  name: 'sso.scimGroupFields',
  input: z.object({ id: z.uuid() }),
  output: GroupFieldsInput.nullable(),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const [g] = await tx.select().from(scimGroups).where(eq(scimGroups.id, input.id));
    if (!g) return null;
    const members = await tx
      .select({ id: scimGroupMembers.scimUserId })
      .from(scimGroupMembers)
      .where(eq(scimGroupMembers.groupId, g.id));
    return { displayName: g.displayName, externalId: g.externalId, members: members.map((m) => m.id) };
  },
});

export const scimGetGroupQuery = tenantQuery({
  name: 'sso.scimGetGroup',
  input: z.object({ id: z.uuid(), baseUrl: BaseUrl }),
  output: ScimGroupResource.nullable(),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const [g] = await tx.select().from(scimGroups).where(eq(scimGroups.id, input.id));
    return g ? groupResourceTx(tx, g, input.baseUrl) : null;
  },
});

export const scimListGroupsQuery = tenantQuery({
  name: 'sso.scimListGroups',
  input: ListInput,
  output: z.object({
    schemas: z.array(z.string()),
    totalResults: z.number().int(),
    startIndex: z.number().int(),
    itemsPerPage: z.number().int(),
    Resources: z.array(ScimGroupResource),
  }),
  ...SCIM,
  handler: async ({ input, tx }) => {
    const f = input.filter;
    const where = !f
      ? undefined
      : f.attribute === 'displayName'
        ? sql`lower(${scimGroups.displayName}) = ${f.value.toLowerCase()}`
        : eq(scimGroups.externalId, f.value);
    const [total] = await tx.select({ n: count() }).from(scimGroups).where(where);
    const rows = await tx
      .select()
      .from(scimGroups)
      .where(where)
      .orderBy(asc(scimGroups.createdAt), asc(scimGroups.id))
      .limit(input.count)
      .offset(input.startIndex - 1);
    const out: ScimGroupResource[] = [];
    for (const r of rows) out.push(await groupResourceTx(tx, r, input.baseUrl));
    return listResponse(out, total?.n ?? 0, input.startIndex);
  },
});

// ---------------------------------------------------------------------------------------------
// Group → role mapping (console)

/**
 * Map a SCIM group to an org role (or none). Members of mapped groups get the strongest mapped
 * role at once; owners are never changed; members whose last mapped group is unmapped keep the
 * role they have. Step-up: it grants roles.
 */
export const setGroupRoleCommand = tenantCommand({
  name: 'sso.setGroupRole',
  input: z.object({ groupId: z.uuid(), role: z.enum(SSO_ROLES).nullable() }),
  output: z.object({ id: z.uuid(), role: z.enum(SSO_ROLES).nullable() }),
  entitlement: 'enterprise',
  permission: 'sso:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const [g] = await tx
      .update(scimGroups)
      .set({ role: input.role, updatedAt: ctx.now })
      .where(eq(scimGroups.id, input.groupId))
      .returning();
    if (!g) throw new DomainError('not_found');
    const members = await tx
      .select({ id: scimGroupMembers.scimUserId })
      .from(scimGroupMembers)
      .where(eq(scimGroupMembers.groupId, g.id));
    await resyncUsersTx(
      tx,
      ctx,
      members.map((m) => m.id),
      emit,
    );
    return { id: g.id, role: g.role as SsoRole | null };
  },
  audit: (input) => ({
    action: 'sso.group.map_role',
    targetType: 'scim_group',
    targetId: input.groupId,
    data: { role: input.role },
  }),
});
