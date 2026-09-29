import { executeQuery } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, DEVICES_CHANNEL, realtimeChannelName } from '@yayatoh/platform';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice, staffOverview } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Staff mode (M3.4a): counts, the device board and alerts for the device's event. Device token
 * only; the PWA keeps the last answer for offline use ("last updated").
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const eventId = new URL(req.url).searchParams.get('eventId') ?? '';
  if (!UUID.test(eventId)) return problemResponse(problem('validation_failed', 'eventId'));
  try {
    const view = await executeQuery(staffOverview, { eventId }, device.ctx, ports);
    const orgId = device.ctx.orgId ?? '';
    // The channels to follow (the device doesn't know its org id; the token does).
    const channels = {
      checkins: realtimeChannelName(CHECKINS_CHANNEL, orgId, eventId),
      devices: realtimeChannelName(DEVICES_CHANNEL, orgId, eventId),
    };
    return Response.json({ ...view, channels }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
