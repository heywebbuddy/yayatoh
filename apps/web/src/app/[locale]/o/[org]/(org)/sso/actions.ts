'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  addDomainCommand,
  checkConnection,
  checkDomainCommand,
  connectionView,
  createScimTokenCommand,
  deleteConnectionCommand,
  recordConnectionTestCommand,
  removeDomainCommand,
  revokeScimTokenCommand,
  type SaveConnectionInput,
  saveConnectionCommand,
  setConnectionStatusCommand,
  setDomainEnforcementCommand,
  setGroupRoleCommand,
  ssoSettingsQuery,
} from '@yayatoh/sso';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { beginSso, SSO_STATE_MAX_AGE_S, ssoStateCookie } from '@/server/sso.ts';

/** What a settings form answers: saved, or an error code with the fields it concerns. */
export type SsoFormState =
  | { readonly kind: 'idle'; readonly code?: undefined }
  | { readonly kind: 'saved'; readonly code?: undefined }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly fields: readonly string[];
      readonly reason?: string;
    };

function failure(err: unknown): SsoFormState {
  if (!isDomainError(err)) return { kind: 'error', code: 'internal', fields: [] };
  const issues = (err.details?.issues as { path: string | (string | number)[] }[] | undefined) ?? [];
  const fields = [...new Set(issues.map((i) => String(Array.isArray(i.path) ? i.path[0] : i.path)))];
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
  return { kind: 'error', code: err.code, fields, ...(reason ? { reason } : {}) };
}

const text = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === 'string' ? v.trim() : '';
};
const orNull = (s: string) => (s === '' ? null : s);

async function run(
  org: string,
  fn: (data: Awaited<ReturnType<typeof loadConsole>>) => Promise<unknown>,
): Promise<SsoFormState> {
  const data = await loadConsole(org);
  try {
    await fn(data);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/sso`);
  return { kind: 'saved' };
}

/** Create or change the IdP connection (SAML from metadata or by hand, or OIDC). */
export async function saveConnectionAction(
  org: string,
  _prev: SsoFormState,
  form: FormData,
): Promise<SsoFormState> {
  const protocol = text(form, 'protocol') === 'oidc' ? 'oidc' : 'saml';
  const common = {
    name: text(form, 'name'),
    defaultRole: (text(form, 'defaultRole') || 'viewer') as 'viewer',
    jit: form.get('jit') === 'on',
  };
  if (!common.name) return { kind: 'error', code: 'validation_failed', fields: ['name'] };
  let input: SaveConnectionInput;
  if (protocol === 'oidc') {
    input = {
      protocol,
      ...common,
      issuer: text(form, 'issuer'),
      clientId: text(form, 'clientId'),
      clientSecret: orNull(text(form, 'clientSecret')),
    };
  } else {
    const source = text(form, 'samlSource');
    input = {
      protocol,
      ...common,
      metadataXml: source === 'xml' ? orNull(text(form, 'metadataXml')) : null,
      metadataUrl: source === 'url' ? orNull(text(form, 'metadataUrl')) : null,
      entityId: source === 'manual' ? orNull(text(form, 'entityId')) : null,
      ssoUrl: source === 'manual' ? orNull(text(form, 'ssoUrl')) : null,
      certificate: source === 'manual' ? orNull(text(form, 'certificate')) : null,
    };
    // Nothing given for the chosen source: say which field is missing.
    const missing =
      source === 'xml' && !input.metadataXml
        ? 'metadataXml'
        : source === 'url' && !input.metadataUrl
          ? 'metadataUrl'
          : source === 'manual' && !input.entityId
            ? 'entityId'
            : null;
    if (missing) return { kind: 'error', code: 'validation_failed', fields: [missing] };
  }
  return run(org, (data) => executeCommand(saveConnectionCommand, input, data.ctx, ports));
}

export async function setConnectionStatusAction(
  org: string,
  _prev: SsoFormState,
  form: FormData,
): Promise<SsoFormState> {
  const status = text(form, 'status') === 'active' ? 'active' : 'disabled';
  return run(org, (data) => executeCommand(setConnectionStatusCommand, { status }, data.ctx, ports));
}

export async function deleteConnectionAction(
  org: string,
  _prev: SsoFormState,
  _form: FormData,
): Promise<SsoFormState> {
  return run(org, (data) => executeCommand(deleteConnectionCommand, {}, data.ctx, ports));
}

/** Start a test sign-in at the IdP (nobody is signed in by it; the result comes back here). */
export async function testConnectionAction(
  org: string,
  _prev: SsoFormState,
  _form: FormData,
): Promise<SsoFormState> {
  const data = await loadConsole(org);
  let url: string;
  try {
    const s = await executeQuery(ssoSettingsQuery, {}, data.ctx, ports);
    if (!s.connection) return { kind: 'error', code: 'not_found', fields: [] };
    if (data.ctx.actor.type !== 'user') return { kind: 'error', code: 'forbidden', fields: [] };
    // The settings first (certificate, discovery): a broken connection never reaches the IdP.
    const view = await connectionView(data.org.id, s.connection.id);
    const check = view ? await checkConnection(view, new Date()) : null;
    if (check && !check.ok) {
      if (check.reason !== 'sso_unavailable')
        await executeCommand(
          recordConnectionTestCommand,
          { connectionId: s.connection.id, ok: false, reason: check.reason },
          data.ctx,
          ports,
        );
      revalidatePath(`/o/${org}/sso`);
      return { kind: 'error', code: 'invalid_state', fields: [], reason: check.reason };
    }
    const started = await beginSso(
      {
        orgId: data.org.id,
        orgSlug: data.org.slug,
        connectionId: s.connection.id,
        locale: data.ctx.locale ?? 'en',
        intent: 'test',
        userId: data.ctx.actor.userId,
      },
      data.session.email,
    );
    if (!started) return { kind: 'error', code: 'invalid_state', fields: [], reason: 'sso_unavailable' };
    const here = await requestHost();
    const https = here.protocol === 'https:';
    (await cookies()).set(ssoStateCookie(https), started.state, {
      httpOnly: true,
      secure: https,
      sameSite: https ? 'none' : 'lax',
      path: '/',
      maxAge: SSO_STATE_MAX_AGE_S,
    });
    url = started.url;
  } catch (err) {
    return failure(err);
  }
  redirect(url);
}

export async function addDomainAction(
  org: string,
  _prev: SsoFormState,
  form: FormData,
): Promise<SsoFormState> {
  const domain = text(form, 'domain');
  if (!domain) return { kind: 'error', code: 'validation_failed', fields: ['domain'] };
  return run(org, (data) => executeCommand(addDomainCommand, { domain }, data.ctx, ports));
}

export async function checkDomainAction(
  org: string,
  domainId: string,
  _prev: SsoFormState,
  _form: FormData,
): Promise<SsoFormState> {
  return run(org, (data) => executeCommand(checkDomainCommand, { domainId }, data.ctx, ports));
}

export async function removeDomainAction(
  org: string,
  domainId: string,
  _prev: SsoFormState,
  _form: FormData,
): Promise<SsoFormState> {
  return run(org, (data) => executeCommand(removeDomainCommand, { domainId }, data.ctx, ports));
}

export async function setEnforcementAction(
  org: string,
  domainId: string,
  _prev: SsoFormState,
  form: FormData,
): Promise<SsoFormState> {
  const enforced = text(form, 'enforced') === 'on';
  return run(org, (data) =>
    executeCommand(setDomainEnforcementCommand, { domainId, enforced }, data.ctx, ports),
  );
}

export type TokenState =
  | { readonly kind: 'idle'; readonly code?: undefined }
  | { readonly kind: 'created'; readonly token: string; readonly code?: undefined }
  | { readonly kind: 'revoked'; readonly code?: undefined }
  | { readonly kind: 'error'; readonly code: string };

/** A new SCIM token (rotating the live one): returned once, to this form only. */
export async function createScimTokenAction(
  org: string,
  _prev: TokenState,
  _form: FormData,
): Promise<TokenState> {
  const data = await loadConsole(org);
  try {
    const r = await executeCommand(createScimTokenCommand, {}, data.ctx, ports);
    revalidatePath(`/o/${org}/sso`);
    return { kind: 'created', token: r.token };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function revokeScimTokenAction(
  org: string,
  _prev: TokenState,
  _form: FormData,
): Promise<TokenState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(revokeScimTokenCommand, {}, data.ctx, ports);
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/sso`);
  return { kind: 'revoked' };
}

export async function setGroupRoleAction(
  org: string,
  groupId: string,
  _prev: SsoFormState,
  form: FormData,
): Promise<SsoFormState> {
  const raw = text(form, 'role');
  const role = (raw === 'none' || raw === '' ? null : raw) as 'viewer' | null;
  return run(org, (data) => executeCommand(setGroupRoleCommand, { groupId, role }, data.ctx, ports));
}
