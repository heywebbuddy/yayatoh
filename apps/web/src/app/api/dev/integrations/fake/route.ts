import {
  DEMO_BAD_RECORD,
  demoRemoteUpdate,
  fakeIntegrations,
  hubspotRemoteOptOut,
  klaviyoRemoteSet,
  mailchimpRemoteSet,
} from '@yayatoh/integrations';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dev/CI only (M6.4a): act at the fake provider for one of our connections, as the organizer
 * would in the provider's own app — `revoke` our access, or `fix` the demo's broken record; M6.4d:
 * `unsubscribe`, `clean` or `complain` an address (`email`, and `list` for Mailchimp and Klaviyo). 404
 * unless dev auth is on and the port is the fake.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const connectionId = String(form.get('connection') ?? '');
  const action = String(form.get('action') ?? '');
  const account = UUID.test(connectionId) ? fakeIntegrations.accountFor(connectionId) : null;
  if (!account) return NextResponse.json({ error: 'unknown_connection' }, { status: 404 });
  if (action === 'revoke') fakeIntegrations.revokeAtProvider(account.authConnectionId);
  else if (action === 'unsubscribe' || action === 'clean' || action === 'complain') {
    // M6.4d: the person unsubscribes (or the address bounces, or they complain) in the marketing
    // tool itself; the next sync brings it back as a consent change.
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const list = String(form.get('list') ?? '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 320)
      return NextResponse.json({ error: 'bad_email' }, { status: 400 });
    const key = account.providerConfigKey;
    if (key !== 'hubspot' && !/^[A-Za-z0-9_-]{1,100}$/.test(list))
      return NextResponse.json({ error: 'bad_list' }, { status: 400 });
    if (key === 'mailchimp')
      mailchimpRemoteSet(account, list, email, action === 'clean' ? 'cleaned' : 'unsubscribed');
    else if (key === 'klaviyo')
      klaviyoRemoteSet(
        account,
        list,
        email,
        action === 'clean' ? 'cleaned' : action === 'complain' ? 'complained' : 'unsubscribed',
      );
    else if (key === 'hubspot' && action === 'unsubscribe') {
      if (!hubspotRemoteOptOut(account, email))
        return NextResponse.json({ error: 'unknown_contact' }, { status: 404 });
    } else return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } else if (action === 'fix')
    demoRemoteUpdate(account, DEMO_BAD_RECORD, {
      email_address: `fixed.${connectionId.slice(-8)}@demo-remote.test`,
    });
  else return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
