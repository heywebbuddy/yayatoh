import { staffOverviewFor } from '@yayatoh/api-v1/staff';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Staff mode (M3.4a): counts, the device board and alerts for the device's event. Device token
 * only; the PWA keeps the last answer for offline use ("last updated"). The same answer as
 * `GET /v1/staff/events/{eventId}/overview` (M7.2e): both call `staffOverviewFor`.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const eventId = new URL(req.url).searchParams.get('eventId') ?? '';
  if (!UUID.test(eventId)) return problemResponse(problem('validation_failed', 'eventId'));
  try {
    return Response.json(await staffOverviewFor(device.ctx, eventId, ports), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
