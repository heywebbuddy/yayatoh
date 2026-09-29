import { staffPushStatusQuery, unsubscribeStaffPushCommand } from '@yayatoh/checkin';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice, subscribeStaffPush } from '@/server/scan-staff.ts';

/**
 * Staff web push on this device (M3.4a, opt-in per device): GET says whether it is on, POST
 * subscribes (the browser's subscription plus the notification text in the device's language),
 * DELETE turns it off. Device token only.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json(await executeQuery(staffPushStatusQuery, {}, device.ctx, ports), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

const unpad = (v: unknown) => (typeof v === 'string' ? v.replace(/=+$/, '') : v);

export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    locale?: unknown;
    copy?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  try {
    await executeCommand(
      subscribeStaffPush,
      {
        endpoint: body.endpoint as string,
        keys: { p256dh: unpad(body.keys?.p256dh) as string, auth: unpad(body.keys?.auth) as string },
        locale: body.locale as string,
        copy: body.copy as never,
      },
      device.ctx,
      ports,
    );
    return Response.json({ ok: true });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function DELETE(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json(await executeCommand(unsubscribeStaffPushCommand, {}, device.ctx, ports));
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
