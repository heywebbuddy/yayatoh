import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import {
  completePersonalCalendarCommand,
  failPersonalCalendarCommand,
  googleCalendarPersonalConnector,
  pendingPersonalCalendarQuery,
} from '@yayatoh/integrations';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The personal calendar's OAuth callback (M6.5c): Google's consent screen (the fake's own page in
 * dev and CI) returns here with the single-use `state`. The manage link in the path is the
 * credential; the state must be this registrant's pending connection's, unexpired. The port then
 * confirms the provider-side connection (ids only) and the first sync is queued. Never cached; no
 * token ever passes through.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; token: string; registrant: string }> },
) {
  const { locale, token, registrant } = await params;
  const url = new URL(req.url);
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const go = (calendar: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `${prefix}/orders/${token}/schedule?${new URLSearchParams({ registrant, calendar }).toString()}#calendar`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  const auth = integrationAuth();
  const state = url.searchParams.get('state') ?? '';
  const orgId = UUID.test(registrant) ? await manageTokenOrg(token) : null;
  if (!auth || !orgId || state.length < 16 || state.length > 200) return go('expired');
  const ctx = createCtx({ orgId });
  const link = { token, registrantId: registrant };
  let connectionId: string;
  try {
    ({ connectionId } = await executeQuery(pendingPersonalCalendarQuery, { ...link, state }, ctx, ports));
  } catch {
    return go('expired');
  }
  const fail = async (calendar: string) => {
    await executeCommand(failPersonalCalendarCommand, { ...link, connectionId }, ctx, ports).catch(() => undefined);
    return go(calendar);
  };
  if (url.searchParams.get('error')) return fail('denied');
  const resolved = await auth
    .resolve({ orgId, connectionId, providerConfigKey: googleCalendarPersonalConnector.providerConfigKey })
    .catch(() => null);
  if (!resolved) return fail('denied');
  try {
    await executeCommand(
      completePersonalCalendarCommand,
      { ...link, connectionId, state, authConnectionId: resolved.authConnectionId },
      ctx,
      ports,
    );
  } catch {
    return go('expired');
  }
  return go('connected');
}
