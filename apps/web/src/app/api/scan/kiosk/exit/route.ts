import { exitKioskCommand } from '@yayatoh/checkin';
import { executeCommand } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

/**
 * A kiosk reports that someone left kiosk mode with the PIN (checked on the device, so it works
 * offline; this report follows once online). Device token only; audited as `device.kiosk_exit`.
 */
export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: { startedAt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  try {
    return Response.json(
      await executeCommand(exitKioskCommand, { startedAt: body.startedAt as never }, device.ctx, ports),
    );
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
