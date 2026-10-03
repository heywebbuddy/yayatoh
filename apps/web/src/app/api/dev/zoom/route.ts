import { signZoomWebhook, zoomWebhookSecretFromEnv } from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.10a e2e): the fake Zoom's side of a join/leave webhook. Builds the body Zoom
 * would send for a participant joining or leaving a webinar and signs it with the fake secret, so
 * a test can deliver it (and replay it) to the real `/api/webhooks/zoom`. 404 unless dev auth is
 * on and no real `ZOOM_WEBHOOK_SECRET_TOKEN` is configured; never in production.
 */
export async function POST(req: NextRequest) {
  const secret = zoomWebhookSecretFromEnv(process.env);
  if (!devAuthEnabled() || process.env.ZOOM_WEBHOOK_SECRET_TOKEN || !secret)
    return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const webinar = String(form.get('webinar') ?? '');
  const email = String(form.get('email') ?? '').slice(0, 320);
  const kind = form.get('kind') === 'left' ? 'left' : 'joined';
  const at = new Date(String(form.get('at') ?? new Date().toISOString()));
  const participant = String(form.get('participant') ?? email).slice(0, 200);
  if (!/^[0-9]{9,12}$/.test(webinar) || Number.isNaN(at.getTime()))
    return NextResponse.json({ error: 'validation_failed' }, { status: 400 });
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
