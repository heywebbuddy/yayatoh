import {
  DEMO_BAD_RECORD,
  demoRemoteUpdate,
  fakeCalendarAllEvents,
  fakeIntegrations,
} from '@yayatoh/integrations';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dev/CI only (M6.4a): act at the fake provider for one of our connections, as the organizer
 * would in the provider's own app — `revoke` our access, or `fix` the demo's broken record — or
 * (M6.5c) look at a fake Google Calendar's entries (`calendar`: titles, times, zones, status and
 * how many writes each had). 404 unless dev auth is on and the port is the fake.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const connectionId = String(form.get('connection') ?? '');
  const action = String(form.get('action') ?? '');
  const account = UUID.test(connectionId) ? fakeIntegrations.accountFor(connectionId) : null;
  if (!account) return NextResponse.json({ error: 'unknown_connection' }, { status: 404 });
  if (action === 'calendar')
    return NextResponse.json({
      events: fakeCalendarAllEvents(account).map((e) => ({
        summary: e.summary,
        status: e.status,
        start: e.start,
        end: e.end,
        writes: e.writes,
      })),
    });
  if (action === 'revoke') fakeIntegrations.revokeAtProvider(account.authConnectionId);
  else if (action === 'fix')
    demoRemoteUpdate(account, DEMO_BAD_RECORD, {
      email_address: `fixed.${connectionId.slice(-8)}@demo-remote.test`,
    });
  else return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
