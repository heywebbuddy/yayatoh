import { z } from 'zod';

/**
 * SCIM 2.0 (RFC 7643 resources, RFC 7644 protocol) for M6.5a: the parts IdPs use to provision
 * people (Okta, Microsoft Entra ID, OneLogin, JumpCloud): Users and Groups with create, read,
 * list with an `eq` filter, replace, PATCH and delete. Pure functions: parsing requests, applying
 * PATCH operations, and the allowlisted resources we answer with.
 */
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_MAX_PAGE = 200;
/** Members per group request: larger groups are sent in several PATCH requests by IdPs. */
export const SCIM_MAX_MEMBERS = 1000;

export type ScimErrorType =
  | 'invalidFilter'
  | 'invalidSyntax'
  | 'invalidValue'
  | 'invalidPath'
  | 'noTarget'
  | 'mutability'
  | 'uniqueness'
  | 'tooMany';

/** An error the SCIM endpoint answers with (RFC 7644 §3.12). `detail` never echoes input. */
export class ScimError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 501;
  readonly detail: string;
  readonly scimType: ScimErrorType | undefined;
  constructor(status: ScimError['status'], detail: string, scimType?: ScimErrorType) {
    super(detail);
    this.name = 'ScimError';
    this.status = status;
    this.detail = detail;
    this.scimType = scimType;
  }
}

export const scimErrorBody = (e: ScimError) => ({
  schemas: [SCIM_ERROR_SCHEMA],
  status: String(e.status),
  ...(e.scimType ? { scimType: e.scimType } : {}),
  detail: e.detail,
});

// ---------------------------------------------------------------------------------------------
// Filters

export interface ScimFilter {
  readonly attribute: string;
  readonly value: string;
}

/**
 * `attr eq "value"` (case-insensitive operator and attribute names, as IdPs send them). Only the
 * listed attributes and only `eq`: anything else is `invalidFilter` (an IdP then lists and matches
 * itself). Null for no filter.
 */
export function parseFilter(filter: string | null, allowed: readonly string[]): ScimFilter | null {
  if (filter === null || filter.trim() === '') return null;
  if (filter.length > 500) throw new ScimError(400, 'Filter too long', 'invalidFilter');
  const m = /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m?.[1]) throw new ScimError(400, 'Only "attribute eq value" filters are supported', 'invalidFilter');
  const attribute = allowed.find((a) => a.toLowerCase() === m[1]?.toLowerCase());
  if (!attribute) throw new ScimError(400, 'Filtering on this attribute is not supported', 'invalidFilter');
  return { attribute, value: (m[2] ?? '').replace(/\\(.)/g, '$1') };
}

/** `startIndex` (1-based) and `count` (capped). */
export function parsePage(q: { startIndex?: string | null; count?: string | null }) {
  const start = Number.parseInt(q.startIndex ?? '1', 10);
  const count = Number.parseInt(q.count ?? String(SCIM_MAX_PAGE), 10);
  return {
    startIndex: Number.isFinite(start) && start > 0 ? start : 1,
    count: Number.isFinite(count) ? Math.min(Math.max(count, 0), SCIM_MAX_PAGE) : SCIM_MAX_PAGE,
  };
}

// ---------------------------------------------------------------------------------------------
// Users

export interface UserFields {
  readonly userName: string;
  /** The address the person signs in with: the primary email, else `userName` when it is one. */
  readonly email: string;
  readonly externalId: string | null;
  readonly displayName: string | null;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly active: boolean;
}

/** SCIM booleans: Entra sends `"False"` and `"True"` as strings. */
const ScimBool = z.union([
  z.boolean(),
  z
    .string()
    .regex(/^(true|false)$/i)
    .transform((s) => s.toLowerCase() === 'true'),
]);
const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s));
const EMAIL = z.email().max(320);

const UserBody = z.object({
  userName: z.string().trim().min(3).max(320),
  externalId: Text(255).nullish(),
  displayName: Text(200).nullish(),
  name: z
    .object({ givenName: Text(100).nullish(), familyName: Text(100).nullish(), formatted: z.unknown() })
    .partial()
    .nullish(),
  emails: z
    .array(z.object({ value: z.string().trim().max(320), primary: ScimBool.optional() }).loose())
    .max(10)
    .nullish(),
  active: ScimBool.optional(),
});

const lower = (s: string) => s.trim().toLowerCase();

function emailOf(
  userName: string,
  emails: readonly { value: string; primary?: boolean }[] | null | undefined,
) {
  const primary = emails?.find((e) => e.primary) ?? emails?.[0];
  const candidate = primary?.value || userName;
  const parsed = EMAIL.safeParse(lower(candidate));
  if (parsed.success) return parsed.data;
  const fallback = EMAIL.safeParse(lower(userName));
  if (fallback.success) return fallback.data;
  throw new ScimError(400, 'The user needs an email address (userName or emails)', 'invalidValue');
}

/** A User resource from a POST or PUT body. */
export function parseUser(body: unknown, current?: UserFields): UserFields {
  const r = UserBody.safeParse(body);
  if (!r.success) throw new ScimError(400, 'The User resource is not valid', 'invalidValue');
  const b = r.data;
  return {
    userName: b.userName,
    email: emailOf(b.userName, b.emails),
    externalId: b.externalId ?? null,
    displayName: b.displayName ?? null,
    givenName: b.name?.givenName ?? null,
    familyName: b.name?.familyName ?? null,
    active: b.active ?? current?.active ?? true,
  };
}

const PatchBody = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z.string().regex(/^(add|replace|remove)$/i),
        path: z.string().max(300).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export interface PatchOp {
  readonly op: 'add' | 'replace' | 'remove';
  readonly path: string | null;
  readonly value: unknown;
}

/** The operations of a PATCH body (RFC 7644 §3.5.2), op names lower-cased. */
export function parsePatch(body: unknown): PatchOp[] {
  const r = PatchBody.safeParse(body);
  if (!r.success) throw new ScimError(400, 'The PATCH request is not valid', 'invalidSyntax');
  return r.data.Operations.map((o) => ({
    op: o.op.toLowerCase() as PatchOp['op'],
    path: o.path?.trim() || null,
    value: o.value,
  }));
}

const one = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ScimError(400, 'Expected a string value', 'invalidValue');
  const t = v.trim();
  if (t.length > max) throw new ScimError(400, 'The value is too long', 'invalidValue');
  return t === '' ? null : t;
};
const bool = (v: unknown): boolean => {
  const r = ScimBool.safeParse(v);
  if (!r.success) throw new ScimError(400, 'Expected a boolean value', 'invalidValue');
  return r.data;
};

/**
 * Apply PATCH operations to a user. Supported paths: `active`, `displayName`, `externalId`,
 * `name.givenName`, `name.familyName`, `userName` (only the same address, e.g. a case change),
 * `emails[type eq "work"].value` / `emails` (only the same address), and a path-less add/replace
 * with an object of those attributes. Unknown attributes are ignored, as the RFC allows for
 * attributes the service provider doesn't support.
 */
export function applyUserPatch(current: UserFields, ops: readonly PatchOp[]): UserFields {
  let u: UserFields = current;
  const set = (path: string, value: unknown, op: PatchOp['op']) => {
    const p = path.toLowerCase();
    const clear = op === 'remove';
    if (p === 'active') {
      if (clear) throw new ScimError(400, 'active cannot be removed', 'mutability');
      u = { ...u, active: bool(value) };
    } else if (p === 'displayname') u = { ...u, displayName: clear ? null : one(value, 200) };
    else if (p === 'externalid') u = { ...u, externalId: clear ? null : one(value, 255) };
    else if (p === 'name.givenname') u = { ...u, givenName: clear ? null : one(value, 100) };
    else if (p === 'name.familyname') u = { ...u, familyName: clear ? null : one(value, 100) };
    else if (p === 'name') {
      const n = (clear ? {} : value) as { givenName?: unknown; familyName?: unknown } | null;
      if (n === null || typeof n !== 'object') throw new ScimError(400, 'Expected an object', 'invalidValue');
      u = {
        ...u,
        givenName: 'givenName' in n || clear ? one(n.givenName, 100) : u.givenName,
        familyName: 'familyName' in n || clear ? one(n.familyName, 100) : u.familyName,
      };
    } else if (p === 'username') {
      const next = one(value, 320);
      if (clear || !next || lower(next) !== lower(u.userName))
        throw new ScimError(400, 'userName cannot change to another address', 'mutability');
      u = { ...u, userName: next };
    } else if (p === 'emails' || /^emails\[[^\]]*\]\.value$/.test(p)) {
      if (clear) return;
      const list = Array.isArray(value) ? (value as { value?: unknown; primary?: unknown }[]) : null;
      const raw = list ? (list.find((e) => e?.primary === true) ?? list[0])?.value : value;
      const next = one(raw, 320);
      if (next && lower(next) !== u.email)
        throw new ScimError(400, 'The email address cannot change to another address', 'mutability');
    }
    // Other attributes (title, phoneNumbers, enterprise extension…) are not kept.
  };
  for (const o of ops) {
    if (o.path) {
      set(o.path, o.value, o.op);
      continue;
    }
    if (o.op === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
    if (!o.value || typeof o.value !== 'object' || Array.isArray(o.value))
      throw new ScimError(400, 'Expected an object of attributes', 'invalidValue');
    for (const [k, v] of Object.entries(o.value as Record<string, unknown>)) {
      if (k === 'schemas' || k === 'id' || k === 'meta') continue;
      set(k, v, o.op);
    }
  }
  return u;
}

// ---------------------------------------------------------------------------------------------
// Groups

export interface GroupFields {
  readonly displayName: string;
  readonly externalId: string | null;
  /** SCIM User ids (our `scim_users.id`). */
  readonly members: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Member = z.object({ value: z.string().trim().max(64) }).loose();
const GroupBody = z.object({
  displayName: z.string().trim().min(1).max(200),
  externalId: Text(255).nullish(),
  members: z.array(Member).max(SCIM_MAX_MEMBERS).nullish(),
});

const memberIds = (list: readonly { value: string }[]) => {
  const ids = list.map((m) => m.value.toLowerCase());
  if (ids.some((id) => !UUID.test(id))) throw new ScimError(400, 'Unknown member id', 'invalidValue');
  return [...new Set(ids)];
};

export function parseGroup(body: unknown): GroupFields {
  const r = GroupBody.safeParse(body);
  if (!r.success) throw new ScimError(400, 'The Group resource is not valid', 'invalidValue');
  return {
    displayName: r.data.displayName,
    externalId: r.data.externalId ?? null,
    members: memberIds(r.data.members ?? []),
  };
}

const membersValue = (v: unknown) => {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const r = z.array(Member).max(SCIM_MAX_MEMBERS).safeParse(list);
  if (!r.success) throw new ScimError(400, 'Expected members', 'invalidValue');
  return memberIds(r.data);
};

/**
 * Apply PATCH operations to a group: `members` add / remove / replace (also
 * `members[value eq "id"]` to remove one), `displayName` and `externalId`, and path-less
 * add/replace objects of those.
 */
export function applyGroupPatch(current: GroupFields, ops: readonly PatchOp[]): GroupFields {
  let g = { ...current, members: [...current.members] };
  const set = (path: string, value: unknown, op: PatchOp['op']) => {
    const filtered = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path);
    const p = path.toLowerCase();
    if (filtered?.[1]) {
      if (op !== 'remove') throw new ScimError(400, 'Only remove works on one member', 'invalidPath');
      const id = filtered[1].toLowerCase();
      g = { ...g, members: g.members.filter((m) => m !== id) };
    } else if (p === 'members') {
      if (op === 'remove') {
        const ids = value === undefined ? null : new Set(membersValue(value));
        g = { ...g, members: ids ? g.members.filter((m) => !ids.has(m)) : [] };
      } else if (op === 'add') g = { ...g, members: [...new Set([...g.members, ...membersValue(value)])] };
      else g = { ...g, members: membersValue(value) };
    } else if (p === 'displayname') {
      const name = op === 'remove' ? null : one(value, 200);
      if (!name) throw new ScimError(400, 'displayName is required', 'invalidValue');
      g = { ...g, displayName: name };
    } else if (p === 'externalid') g = { ...g, externalId: op === 'remove' ? null : one(value, 255) };
    else throw new ScimError(400, 'Unsupported path', 'invalidPath');
    if (g.members.length > SCIM_MAX_MEMBERS) throw new ScimError(400, 'Too many members', 'tooMany');
  };
  for (const o of ops) {
    if (o.path) {
      set(o.path, o.value, o.op);
      continue;
    }
    if (o.op === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
    if (!o.value || typeof o.value !== 'object' || Array.isArray(o.value))
      throw new ScimError(400, 'Expected an object of attributes', 'invalidValue');
    for (const [k, v] of Object.entries(o.value as Record<string, unknown>)) {
      if (k === 'schemas' || k === 'id' || k === 'meta') continue;
      set(k, v, o.op);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Resources we answer with (allowlists)

const Meta = z.strictObject({
  resourceType: z.enum(['User', 'Group']),
  created: z.string(),
  lastModified: z.string(),
  location: z.string(),
});

export const ScimUserResource = z.strictObject({
  schemas: z.tuple([z.literal(SCIM_USER_SCHEMA)]),
  id: z.uuid(),
  externalId: z.string().optional(),
  userName: z.string(),
  displayName: z.string().optional(),
  name: z.strictObject({ givenName: z.string().optional(), familyName: z.string().optional() }),
  emails: z.array(z.strictObject({ value: z.string(), type: z.literal('work'), primary: z.literal(true) })),
  active: z.boolean(),
  groups: z.array(z.strictObject({ value: z.uuid(), display: z.string() })),
  meta: Meta,
});
export type ScimUserResource = z.infer<typeof ScimUserResource>;

export const ScimGroupResource = z.strictObject({
  schemas: z.tuple([z.literal(SCIM_GROUP_SCHEMA)]),
  id: z.uuid(),
  externalId: z.string().optional(),
  displayName: z.string(),
  members: z.array(z.strictObject({ value: z.uuid(), display: z.string() })),
  meta: Meta,
});
export type ScimGroupResource = z.infer<typeof ScimGroupResource>;

const opt = <K extends string>(k: K, v: string | null) => (v ? { [k]: v } : {}) as Partial<Record<K, string>>;

export function userResource(
  r: {
    id: string;
    userName: string;
    email: string;
    externalId: string | null;
    displayName: string | null;
    givenName: string | null;
    familyName: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    groups: readonly { id: string; displayName: string }[];
  },
  baseUrl: string,
): ScimUserResource {
  return ScimUserResource.parse({
    schemas: [SCIM_USER_SCHEMA],
    id: r.id,
    ...opt('externalId', r.externalId),
    userName: r.userName,
    ...opt('displayName', r.displayName),
    name: { ...opt('givenName', r.givenName), ...opt('familyName', r.familyName) },
    emails: [{ value: r.email, type: 'work', primary: true }],
    active: r.active,
    groups: r.groups.map((g) => ({ value: g.id, display: g.displayName })),
    meta: {
      resourceType: 'User',
      created: r.createdAt.toISOString(),
      lastModified: r.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${r.id}`,
    },
  });
}

export function groupResource(
  r: {
    id: string;
    displayName: string;
    externalId: string | null;
    createdAt: Date;
    updatedAt: Date;
    members: readonly { id: string; userName: string }[];
  },
  baseUrl: string,
): ScimGroupResource {
  return ScimGroupResource.parse({
    schemas: [SCIM_GROUP_SCHEMA],
    id: r.id,
    ...opt('externalId', r.externalId),
    displayName: r.displayName,
    members: r.members.map((m) => ({ value: m.id, display: m.userName })),
    meta: {
      resourceType: 'Group',
      created: r.createdAt.toISOString(),
      lastModified: r.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${r.id}`,
    },
  });
}

export const listResponse = <T>(resources: readonly T[], total: number, startIndex: number) => ({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: total,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
});

/** RFC 7644 §5: what this service provider supports. */
export const serviceProviderConfig = (docsUrl: string) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  documentationUri: docsUrl,
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: SCIM_MAX_PAGE },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'The SCIM token from Settings → Single sign-on',
      primary: true,
    },
  ],
});

export const resourceTypes = (baseUrl: string) =>
  listResponse(
    [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: SCIM_USER_SCHEMA,
        meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/User` },
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: SCIM_GROUP_SCHEMA,
        meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/Group` },
      },
    ],
    2,
    1,
  );
