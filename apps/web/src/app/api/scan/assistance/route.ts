import { openAssistanceQueue, raiseStaffRequest } from '@yayatoh/api-v1/staff';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Help requests on the Scan PWA (M3.3b, device token only): GET the event's open queue (the
 * staff screen), POST a staff request (backup, supervisor, medical, security, device) tied to
 * this device and the entrance it scans at.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const eventId = new URL(req.url).searchParams.get('eventId') ?? '';
  if (!UUID.test(eventId)) return problemResponse(problem('validation_failed', 'eventId'));
  try {
    const requests = await openAssistanceQueue(device.ctx, eventId, ports);
    return Response.json({ requests }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: { eventId?: unknown; reason?: unknown; note?: unknown; checkpointId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  try {
    return Response.json(await raiseStaffRequest(device.ctx, body, ports), { status: 201 });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
