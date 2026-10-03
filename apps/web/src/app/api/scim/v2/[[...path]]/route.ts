import { findOrCreateSsoAccount, revokeAllSessions } from '@yayatoh/auth';
import { type Ctx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  applyGroupPatch,
  applyUserPatch,
  parseFilter,
  parseGroup,
  parsePage,
  parsePatch,
  parseUser,
  resourceTypes,
  ScimError,
  type ScimErrorType,
  scimCreateGroupCommand,
  scimCreateUserCommand,
  scimCtx,
  scimDeleteGroupCommand,
  scimDeleteUserCommand,
  scimEmailAllowed,
  scimErrorBody,
  scimGetGroupQuery,
  scimGetUserQuery,
  scimGroupFieldsQuery,
  scimListGroupsQuery,
  scimListUsersQuery,
  scimTokenIdentity,
  scimUpdateGroupCommand,
  scimUpdateUserCommand,
  scimUserFieldsQuery,
  serviceProviderConfig,
} from '@yayatoh/sso';
import { type NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/server/auth.ts';
import { ports } from '@/server/ports.ts';
import { appOrigin } from '@/server/tenant-return.ts';

export const dynamic = 'force-dynamic';

/**
 * SCIM 2.0 service provider (M6.5a): `/api/scim/v2/{Users,Groups}[/{id}]`, `ServiceProviderConfig`,
 * `ResourceTypes`. The bearer token names the org (never a header or the path); every write is a
 * command as the system actor `scim:<token id>`. Users are provisioned only for addresses in the
 * org's verified domains; deactivating or deleting one ends their membership and every session at
 * once. Errors are SCIM error bodies that never echo the request.
 */
const JSON_TYPE = 'application/scim+json';
const MAX_BODY = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new NextResponse(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...headers },
  });
const fail = (e: ScimError) => reply(scimErrorBody(e), e.status);

/** A command's refusal as a SCIM error. */
function domainFailure(err: unknown): NextResponse {
  if (err instanceof ScimError) return fail(err);
  if (!isDomainError(err)) throw err;
  const scimType = err.details?.scimType as ScimErrorType | undefined;
  switch (err.code) {
    case 'not_found':
      return fail(new ScimError(404, 'Resource not found'));
    case 'conflict':
      return fail(new ScimError(409, 'A resource with this value exists', scimType ?? 'uniqueness'));
    case 'validation_failed':
      return fail(new ScimError(400, 'The request is not valid', scimType ?? 'invalidValue'));
    case 'invalid_state':
      return fail(new ScimError(409, 'The organization needs at least one owner', scimType ?? 'mutability'));
    case 'module_not_enabled':
    case 'forbidden':
      return fail(new ScimError(403, 'Provisioning is not enabled for this organization'));
    case 'read_only_freeze':
      return fail(new ScimError(500, 'Temporarily read-only; retry later'));
    default:
      return fail(new ScimError(500, 'Something went wrong'));
  }
}

async function authorize(req: NextRequest): Promise<Ctx | null> {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  const id = m?.[1] ? await scimTokenIdentity(m[1]) : null;
  return id ? scimCtx(id.orgId, id.tokenId) : null;
}

async function body(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY) throw new ScimError(413, 'The request is too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new ScimError(413, 'The request is too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new ScimError(400, 'The body is not JSON', 'invalidSyntax');
  }
}

const baseUrl = () => `${appOrigin()}/api/scim/v2`;

type Params = { params: Promise<{ path?: string[] }> };

async function route(
  req: NextRequest,
  { params }: Params,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
) {
  const ctx = await authorize(req);
  if (!ctx)
    return reply(scimErrorBody(new ScimError(401, 'A valid SCIM bearer token is required')), 401, {
      'www-authenticate': 'Bearer realm="scim"',
    });
  const [kind, id, ...rest] = (await params).path ?? [];
  if (rest.length > 0 || (id !== undefined && !UUID.test(id)))
    return fail(new ScimError(404, 'Resource not found'));
  const base = baseUrl();
  try {
    if (kind === 'ServiceProviderConfig' && method === 'GET' && !id)
      return reply(serviceProviderConfig(`${appOrigin()}/help/search?q=SCIM`));
    if (kind === 'ResourceTypes' && method === 'GET' && !id) return reply(resourceTypes(base));
    if (kind === 'Users') return await users(req, ctx, method, id?.toLowerCase(), base);
    if (kind === 'Groups') return await groups(req, ctx, method, id?.toLowerCase(), base);
    return fail(new ScimError(404, 'Resource not found'));
  } catch (err) {
    return domainFailure(err);
  }
}

async function users(req: NextRequest, ctx: Ctx, method: string, id: string | undefined, base: string) {
  const q = req.nextUrl.searchParams;
  if (method === 'GET' && !id) {
    const page = parsePage({ startIndex: q.get('startIndex'), count: q.get('count') });
    const filter = parseFilter(q.get('filter'), ['userName', 'externalId', 'emails.value']);
    return reply(await executeQuery(scimListUsersQuery, { filter, ...page, baseUrl: base }, ctx, ports));
  }
  if (method === 'GET' && id) {
    const r = await executeQuery(scimGetUserQuery, { id, baseUrl: base }, ctx, ports);
    return r ? reply(r) : fail(new ScimError(404, 'User not found'));
  }
  if (method === 'POST' && !id) {
    const fields = parseUser(await body(req));
    if (!(await scimEmailAllowed(ctx, fields.email)))
      throw new ScimError(
        400,
        "The address is not in one of the organization's verified domains",
        'invalidValue',
      );
    const account = await findOrCreateSsoAccount(getAuth(), {
      email: fields.email,
      name: fields.displayName ?? ([fields.givenName, fields.familyName].filter(Boolean).join(' ') || null),
      via: 'scim',
    });
    const r = await executeCommand(
      scimCreateUserCommand,
      { userId: account.userId, fields, baseUrl: base },
      ctx,
      ports,
    );
    if (r.revokeUserId) await revokeAllSessions(r.revokeUserId, 'scim_deprovisioned');
    return reply(r.resource, 201, { location: r.resource.meta.location });
  }
  if ((method === 'PUT' || method === 'PATCH') && id) {
    const current = await executeQuery(scimUserFieldsQuery, { id }, ctx, ports);
    if (!current) throw new ScimError(404, 'User not found');
    const input = await body(req);
    const fields = method === 'PUT' ? parseUser(input, current) : applyUserPatch(current, parsePatch(input));
    const r = await executeCommand(scimUpdateUserCommand, { id, fields, baseUrl: base }, ctx, ports);
    // Deprovisioned: every session and /v1 token ends now (the next request has none).
    if (r.revokeUserId) await revokeAllSessions(r.revokeUserId, 'scim_deprovisioned');
    return reply(r.resource);
  }
  if (method === 'DELETE' && id) {
    const r = await executeCommand(scimDeleteUserCommand, { id }, ctx, ports);
    if (r.revokeUserId) await revokeAllSessions(r.revokeUserId, 'scim_deprovisioned');
    return reply(null, 204);
  }
  throw new ScimError(404, 'Resource not found');
}

async function groups(req: NextRequest, ctx: Ctx, method: string, id: string | undefined, base: string) {
  const q = req.nextUrl.searchParams;
  if (method === 'GET' && !id) {
    const page = parsePage({ startIndex: q.get('startIndex'), count: q.get('count') });
    const filter = parseFilter(q.get('filter'), ['displayName', 'externalId']);
    return reply(await executeQuery(scimListGroupsQuery, { filter, ...page, baseUrl: base }, ctx, ports));
  }
  if (method === 'GET' && id) {
    const r = await executeQuery(scimGetGroupQuery, { id, baseUrl: base }, ctx, ports);
    return r ? reply(r) : fail(new ScimError(404, 'Group not found'));
  }
  if (method === 'POST' && !id) {
    const fields = parseGroup(await body(req));
    const r = await executeCommand(scimCreateGroupCommand, { fields, baseUrl: base }, ctx, ports);
    return reply(r.resource, 201, { location: r.resource.meta.location });
  }
  if ((method === 'PUT' || method === 'PATCH') && id) {
    const current = await executeQuery(scimGroupFieldsQuery, { id }, ctx, ports);
    if (!current) throw new ScimError(404, 'Group not found');
    const input = await body(req);
    const fields = method === 'PUT' ? parseGroup(input) : applyGroupPatch(current, parsePatch(input));
    const r = await executeCommand(scimUpdateGroupCommand, { id, fields, baseUrl: base }, ctx, ports);
    return reply(r.resource);
  }
  if (method === 'DELETE' && id) {
    await executeCommand(scimDeleteGroupCommand, { id }, ctx, ports);
    return reply(null, 204);
  }
  throw new ScimError(404, 'Resource not found');
}

export const GET = (req: NextRequest, p: Params) => route(req, p, 'GET');
export const POST = (req: NextRequest, p: Params) => route(req, p, 'POST');
export const PUT = (req: NextRequest, p: Params) => route(req, p, 'PUT');
export const PATCH = (req: NextRequest, p: Params) => route(req, p, 'PATCH');
export const DELETE = (req: NextRequest, p: Params) => route(req, p, 'DELETE');
