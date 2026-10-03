import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import {
  completeConnectCommand,
  connectorByKey,
  failConnectCommand,
  pendingConnectionQuery,
} from '@yayatoh/integrations';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

/**
 * The OAuth callback (M6.4a): the provider's consent screen (the fake's own page in dev and CI)
 * returns here with the single-use `state`. Only a signed-in member who may manage integrations
 * of this org gets past `loadConsole` and the commands; the state must be this org's pending
 * connection's, unexpired. The port then confirms the provider-side connection (ids and labels
 * only) and the connection becomes active. Never cached; no token ever passes through.
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  const url = new URL(req.url);
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const go = (path: string, q: Record<string, string>) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `${prefix}/o/${org}/integrations${path}?${new URLSearchParams(q).toString()}`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  const data = await loadConsole(org);
  const auth = integrationAuth();
  const state = url.searchParams.get('state') ?? '';
  if (!auth || state.length < 16 || state.length > 200) return go('', { error: 'expired' });
  let pending: { connectionId: string; connector: string };
  try {
    pending = await executeQuery(pendingConnectionQuery, { state }, data.ctx, ports);
  } catch {
    return go('', { error: 'expired' });
  }
  const fail = async (reason: 'denied' | 'not_found', error: string) => {
    await executeCommand(
      failConnectCommand,
      { connectionId: pending.connectionId, reason },
      data.ctx,
      ports,
    ).catch(() => undefined);
    return go('', { error });
  };
  if (url.searchParams.get('error')) return fail('denied', 'denied');
  const def = connectorByKey(pending.connector);
  if (!def) return fail('not_found', 'not_found');
  const resolved = await auth
    .resolve({
      orgId: data.ctx.orgId as string,
      connectionId: pending.connectionId,
      providerConfigKey: def.providerConfigKey,
    })
    .catch(() => null);
  if (!resolved) return fail('not_found', 'not_approved');
  try {
    await executeCommand(
      completeConnectCommand,
      {
        connectionId: pending.connectionId,
        state,
        authConnectionId: resolved.authConnectionId,
        accountLabel: resolved.accountLabel,
      },
      data.ctx,
      ports,
    );
  } catch {
    return go('', { error: 'expired' });
  }
  return go(`/${pending.connectionId}`, { connected: '1' });
}
