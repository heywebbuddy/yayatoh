import { connectorByKey, fakeIntegrations, safeReturnPath } from '@yayatoh/integrations';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dev/CI only (M6.4a): the fake provider's consent answer, a plain form post like a real
 * provider's: Allow creates the provider-side account; either answer sends the browser back to our
 * callback with the state (a full navigation, so the callback's own redirect lands in the address
 * bar). 404 unless dev auth is on and the port is the fake.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? '');
  const connector = connectorByKey(get('provider'));
  const orgId = get('org');
  const connectionId = get('connection');
  const state = get('state');
  const back = get('return');
  if (!connector?.fake || !UUID.test(orgId) || !UUID.test(connectionId) || !state || !safeReturnPath(back))
    return new NextResponse(null, { status: 404 });
  const allow = get('answer') === 'allow';
  if (allow)
    fakeIntegrations.approve(
      { orgId, connectionId, providerConfigKey: connector.providerConfigKey },
      connector.fake,
    );
  const q = new URLSearchParams({ state, ...(allow ? {} : { error: 'access_denied' }) });
  return new NextResponse(null, {
    status: 303,
    headers: { location: `${back}?${q.toString()}`, 'cache-control': 'no-store' },
  });
}
