import { staffPushStatus, subscribeWebPush, unsubscribeStaffPush } from '@yayatoh/api-v1/staff';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

/**
 * Staff web push on this device (M3.4a, opt-in per device): GET says whether it is on, POST
 * subscribes (the browser's subscription plus the notification text in the device's language),
 * DELETE turns it off. Device token only.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json(await staffPushStatus(device.ctx, ports), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: Parameters<typeof subscribeWebPush>[1];
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  try {
    return Response.json(await subscribeWebPush(device.ctx, body, ports));
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function DELETE(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json(await unsubscribeStaffPush(device.ctx, ports));
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
