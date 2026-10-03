import { fakeIntegrations, zoomFakeAttend, zoomFakeRegistrants } from '@yayatoh/integrations';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIN = 60_000;

/**
 * Dev/CI only (M6.9b): act at the fake Zoom for one of our Zoom connections, as Zoom would —
 * `attend` (someone joined the webinar `minutesAgo` minutes ago for `minutes` minutes) or
 * `registrants` (the webinar's registrants, emails only, to check nothing is duplicated). 404
 * unless dev auth is on and the port is the fake.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const connectionId = String(form.get('connection') ?? '');
  const webinar = String(form.get('webinar') ?? '');
  const account = UUID.test(connectionId) ? fakeIntegrations.accountFor(connectionId) : null;
  if (!account || account.providerConfigKey !== 'zoom' || !/^[0-9]{9,12}$/.test(webinar))
    return NextResponse.json({ error: 'unknown_connection' }, { status: 404 });
  const action = String(form.get('action') ?? '');
  if (action === 'registrants')
    return NextResponse.json({ emails: zoomFakeRegistrants(account, webinar).map((r) => r.email) });
  if (action !== 'attend') return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  const email = String(form.get('email') ?? '').slice(0, 320);
  const minutesAgo = Number(form.get('minutesAgo') ?? 0);
  const minutes = Number(form.get('minutes') ?? 0);
  if (!email.includes('@') || !(minutes > 0 && minutes < 600) || !(minutesAgo >= minutes && minutesAgo < 6000))
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const joinedAt = new Date(Date.now() - minutesAgo * MIN);
  zoomFakeAttend(account, webinar, {
    email,
    name: String(form.get('name') ?? 'Guest').slice(0, 80),
    joinedAt,
    leftAt: new Date(joinedAt.getTime() + minutes * MIN),
  });
  return NextResponse.json({ ok: true });
}
