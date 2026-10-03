import { fakeIntegrations, zoomFakeAttend, zoomFakeRegistrants } from '@yayatoh/integrations';
import { signZoomWebhook, zoomWebhookSecretFromEnv } from '@yayatoh/virtual';
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
 *
 * M6.10a: `webhook` builds the join/leave webhook Zoom would send (`kind` joined or left, for
 * `email` at `at`) and signs it with the fake secret, so a test can deliver it, and replay it, to
 * the real `/api/webhooks/zoom`. Never with a real `ZOOM_WEBHOOK_SECRET_TOKEN`.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || integrationAuth()?.provider !== 'fake')
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  if (form.get('action') === 'webhook') return signedWebhook(form);
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
  if (
    !email.includes('@') ||
    !(minutes > 0 && minutes < 600) ||
    !(minutesAgo >= minutes && minutesAgo < 6000)
  )
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

/** M6.10a: a signed join/leave webhook body and its headers (see the route's comment). */
function signedWebhook(form: FormData) {
  const secret = zoomWebhookSecretFromEnv(process.env);
  if (process.env.ZOOM_WEBHOOK_SECRET_TOKEN || !secret) return new NextResponse(null, { status: 404 });
  const webinar = String(form.get('webinar') ?? '');
  const email = String(form.get('email') ?? '').slice(0, 320);
  const kind = form.get('kind') === 'left' ? 'left' : 'joined';
  const at = new Date(String(form.get('at') ?? new Date().toISOString()));
  const participant = String(form.get('participant') ?? email).slice(0, 200);
  if (!/^[0-9]{9,12}$/.test(webinar) || Number.isNaN(at.getTime()))
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const body = JSON.stringify({
    event: kind === 'joined' ? 'webinar.participant_joined' : 'webinar.participant_left',
    event_ts: at.getTime(),
    payload: {
      account_id: 'fake-account',
      object: {
        id: webinar,
        uuid: `fake-instance-${webinar}`,
        participant: {
          user_id: '16778240',
          user_name: email.split('@')[0] ?? 'guest',
          participant_uuid: participant,
          email,
          ...(kind === 'joined' ? { join_time: at.toISOString() } : { leave_time: at.toISOString() }),
        },
      },
    },
  });
  return NextResponse.json({ body, headers: signZoomWebhook(secret, body, new Date()) });
}
