'use server';

import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import {
  ACCOUNT_CATEGORIES,
  type AccountMap,
  beginConnectCommand,
  chartOfAccounts,
  completeConnectCommand,
  connectionDetailQuery,
  connectorByKey,
  disconnectCommand,
  dismissErrorsCommand,
  failConnectCommand,
  isImporter,
  type MappingRule,
  offeredConnectors,
  requestSyncCommand,
  retryErrorsCommand,
  saveAccountMapCommand,
  saveMappingCommand,
  setConnectionPausedCommand,
  setSyncIntervalCommand,
} from '@yayatoh/integrations';
import { type Ctx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { redirect as rawRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const codeOf = (err: unknown) => (isDomainError(err) ? err.code : 'internal');

/** `/ar` for Arabic, nothing for the default locale (`as-needed` prefixes). */
async function localePrefix(): Promise<string> {
  const locale = await getLocale();
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

async function back(org: string, path: string, params: Record<string, string>) {
  const locale = await getLocale();
  revalidatePath(`/o/${org}/integrations`, 'layout');
  return redirect({ href: { pathname: `/o/${org}/integrations${path}`, query: params }, locale });
}

/**
 * Connect: a pending connection with a single-use state, then off to the provider's consent
 * screen through the `IntegrationAuth` port (the fake's own page in dev and CI).
 */
export async function beginConnectAction(org: string, connector: string, _form?: FormData): Promise<void> {
  const data = await loadConsole(org);
  const auth = integrationAuth();
  const def = connectorByKey(connector);
  if (!auth || !def || !offeredConnectors(auth.provider).includes(def))
    return back(org, '', { error: 'unavailable' });
  let begun: { connectionId: string; state: string };
  try {
    begun = await executeCommand(beginConnectCommand, { connector }, data.ctx, ports);
  } catch (err) {
    return back(org, '', { error: codeOf(err) });
  }
  const prefix = await localePrefix();
  let url: string;
  try {
    ({ url } = await auth.beginConnect({
      orgId: data.ctx.orgId as string,
      connectionId: begun.connectionId,
      providerConfigKey: def.providerConfigKey,
      scopes: def.scopes,
      state: begun.state,
      callbackUrl: `${prefix}/o/${org}/integrations/callback`,
    }));
  } catch {
    // The provider (or Nango) is unreachable: the pending connection stays; Connect again later.
    return back(org, '', { error: 'provider_unavailable' });
  }
  rawRedirect(url.startsWith('/') ? `${prefix}${url}` : url);
}

/** A pending connect whose consent finished elsewhere (Nango's hosted page): ask the port. */
export async function checkConnectAction(org: string, connectionId: string, _form?: FormData): Promise<void> {
  const data = await loadConsole(org);
  const auth = integrationAuth();
  if (!auth || !UUID.test(connectionId)) return back(org, '', { error: 'unavailable' });
  const connectorKey = await connectorOf(data.ctx, connectionId);
  const def = connectorKey ? connectorByKey(connectorKey) : null;
  if (!def) return back(org, '', { error: 'not_found' });
  const resolved = await auth
    .resolve({ orgId: data.ctx.orgId as string, connectionId, providerConfigKey: def.providerConfigKey })
    .catch(() => null);
  if (!resolved) return back(org, `/${connectionId}`, { error: 'not_approved' });
  try {
    await executeCommand(
      completeConnectCommand,
      {
        connectionId,
        state: null,
        authConnectionId: resolved.authConnectionId,
        accountLabel: resolved.accountLabel,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, isImporter(def) ? `/${connectionId}/import` : `/${connectionId}`, { connected: '1' });
}

async function connectorOf(ctx: Ctx, connectionId: string) {
  try {
    return (await executeQuery(connectionDetailQuery, { connectionId }, ctx, ports)).connection.connector;
  } catch {
    return null;
  }
}

/** Abandon a pending connect. */
export async function cancelConnectAction(
  org: string,
  connectionId: string,
  _form?: FormData,
): Promise<void> {
  const data = await loadConsole(org);
  try {
    await executeCommand(failConnectCommand, { connectionId, reason: 'cancelled' }, data.ctx, ports);
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, '', { cancelled: '1' });
}

export async function syncNowAction(org: string, connectionId: string, _form?: FormData): Promise<void> {
  const data = await loadConsole(org);
  let already = false;
  try {
    ({ already } = await executeCommand(requestSyncCommand, { connectionId }, data.ctx, ports));
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, `/${connectionId}`, { sync: already ? 'already' : 'queued' });
}

export async function setPausedAction(
  org: string,
  connectionId: string,
  paused: boolean,
  _form?: FormData,
): Promise<void> {
  const data = await loadConsole(org);
  try {
    await executeCommand(setConnectionPausedCommand, { connectionId, paused }, data.ctx, ports);
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, `/${connectionId}`, { done: paused ? 'paused' : 'resumed' });
}

export async function setIntervalAction(org: string, connectionId: string, form: FormData): Promise<void> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      setSyncIntervalCommand,
      { connectionId, minutes: String(form.get('minutes') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  return back(org, `/${connectionId}`, { done: 'interval' });
}

/** Disconnect: revoked here first (syncing stops), then at the provider through the port. */
export async function disconnectAction(org: string, connectionId: string, _form?: FormData): Promise<void> {
  const data = await loadConsole(org);
  let out: { authConnectionId: string | null; providerConfigKey: string };
  try {
    out = await executeCommand(disconnectCommand, { connectionId }, data.ctx, ports);
  } catch (err) {
    return back(org, `/${connectionId}`, { error: codeOf(err) });
  }
  const auth = integrationAuth();
  if (auth && out.authConnectionId)
    await auth
      .revoke({
        orgId: data.ctx.orgId as string,
        connectionId,
        providerConfigKey: out.providerConfigKey,
        authConnectionId: out.authConnectionId,
      })
      // Revoked here already; a provider that cannot be reached keeps a dead token we never use.
      .catch(() => undefined);
  return back(org, `/${connectionId}`, { done: 'disconnected' });
}

export interface MappingState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly version?: number;
  readonly code?: string;
  /** Problems per row (the target's index) or for the whole mapping (`null`). */
  readonly issues?: readonly {
    readonly index: number | null;
    readonly code: string;
    readonly field: string | null;
  }[];
}

/** Save a mapping (a new version). Rows are per target: `source.N`, `transform.N`, `default.N`, `target.N`. */
export async function saveMappingAction(
  org: string,
  connectionId: string,
  objectType: string,
  direction: 'pull' | 'push',
  _prev: MappingState,
  form: FormData,
): Promise<MappingState> {
  const data = await loadConsole(org);
  const rows = Number(form.get('rows') ?? 0);
  const rules: MappingRule[] = [];
  const rowOf: number[] = [];
  for (let i = 0; i < Math.min(rows, 50); i++) {
    const source = String(form.get(`source.${i}`) ?? '');
    if (!source) continue;
    const dflt = String(form.get(`default.${i}`) ?? '').trim();
    rules.push({
      source,
      target: String(form.get(`target.${i}`) ?? ''),
      transform: String(form.get(`transform.${i}`) ?? 'none') as MappingRule['transform'],
      default: dflt || null,
    });
    rowOf.push(i);
  }
  try {
    const saved = await executeCommand(
      saveMappingCommand,
      { connectionId, objectType, direction, rules },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/integrations/${connectionId}`);
    return { status: 'saved', version: saved.version };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const raw = (err.details?.issues as { path?: string; code?: string; field?: string }[] | undefined) ?? [];
    const targets = rules.map((r) => r.target);
    const issues = raw.map((i) => {
      const m = /^rules\.(\d+)/.exec(i.path ?? '');
      const ruleIndex = m ? Number(m[1]) : null;
      // A missing required target belongs to its own row.
      const missingRow =
        i.code === 'missing_required' ? Number(form.get(`row.${i.field}`) ?? Number.NaN) : Number.NaN;
      return {
        index: ruleIndex !== null ? (rowOf[ruleIndex] ?? null) : Number.isNaN(missingRow) ? null : missingRow,
        code: i.code ?? err.code,
        field: i.field ?? (ruleIndex !== null ? (targets[ruleIndex] ?? null) : null),
      };
    });
    return { status: 'error', code: err.code, issues };
  }
}

function errorIds(form: FormData): string[] {
  return form
    .getAll('error')
    .map(String)
    .filter((id) => UUID.test(id))
    .slice(0, 500);
}

export async function retryErrorsAction(org: string, form: FormData): Promise<void> {
  const data = await loadConsole(org);
  const ids = errorIds(form);
  if (!ids.length) return back(org, '/errors', { error: 'validation_failed' });
  let r: { retried: number };
  try {
    r = await executeCommand(retryErrorsCommand, { errorIds: ids }, data.ctx, ports);
  } catch (err) {
    return back(org, '/errors', { error: codeOf(err) });
  }
  return back(org, '/errors', { retried: String(r.retried) });
}

export async function dismissErrorsAction(org: string, form: FormData): Promise<void> {
  const data = await loadConsole(org);
  const ids = errorIds(form);
  if (!ids.length) return back(org, '/errors', { error: 'validation_failed' });
  let r: { dismissed: number };
  try {
    r = await executeCommand(dismissErrorsCommand, { errorIds: ids }, data.ctx, ports);
  } catch (err) {
    return back(org, '/errors', { error: codeOf(err) });
  }
  return back(org, '/errors', { dismissed: String(r.dismissed) });
}

// ── M6.5d: accounting ──────────────────────────────────────────────────────────────────────

export interface AccountMapState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly version?: number;
  readonly code?: string;
  /** Problems per field: a category (`sales`, …) or `startsOn`. */
  readonly issues?: readonly { readonly field: string; readonly code: string }[];
}

/**
 * Save the chart-of-accounts mapping (a new version). Each chosen account is looked up in the
 * provider's chart now (through the port), so only accounts the books really have are stored.
 */
export async function saveAccountMapAction(
  org: string,
  connectionId: string,
  _prev: AccountMapState,
  form: FormData,
): Promise<AccountMapState> {
  const data = await loadConsole(org);
  const auth = integrationAuth();
  if (!auth || !UUID.test(connectionId)) return { status: 'error', code: 'unavailable' };
  let chart: Awaited<ReturnType<typeof chartOfAccounts>>;
  try {
    chart = await chartOfAccounts(data.ctx, ports, auth, connectionId);
  } catch (err) {
    return { status: 'error', code: codeOf(err) };
  }
  if (!chart) return { status: 'error', code: 'provider_unavailable' };
  const issues: { field: string; code: string }[] = [];
  const accounts: Partial<AccountMap> = {};
  for (const category of ACCOUNT_CATEGORIES) {
    const id = String(form.get(`account.${category}`) ?? '');
    const found = chart.find((a) => a.id === id);
    if (!id) issues.push({ field: category, code: 'missing' });
    else if (!found) issues.push({ field: category, code: 'unknown_account' });
    else accounts[category] = found;
  }
  const startsOn = String(form.get('startsOn') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) issues.push({ field: 'startsOn', code: 'missing_date' });
  if (issues.length) return { status: 'error', code: 'validation_failed', issues };
  try {
    const saved = await executeCommand(
      saveAccountMapCommand,
      { connectionId, accounts: accounts as AccountMap, startsOn },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/integrations/${connectionId}`);
    return { status: 'saved', version: saved.version };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const raw = (err.details?.issues as { path?: string; code?: string; field?: string }[] | undefined) ?? [];
    return {
      status: 'error',
      code: err.code,
      issues: raw.map((i) => ({
        field: i.field ?? (i.path ?? '').replace(/^accounts\./, ''),
        code: i.code ?? err.code,
      })),
    };
  }
}
