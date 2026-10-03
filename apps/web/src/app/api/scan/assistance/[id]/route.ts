import { assignCommand, updateCommand } from '@yayatoh/assistance';
import { executeCommand } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

/**
 * Work one help request from the Scan PWA (M3.3b, device token only): `take` gives it to this
 * device; `start`, `resolve` and `cancel` move it on. The request must be at the device's event.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const { id } = await params;
  let body: { eventId?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  const ref = { eventId: body.eventId as string, requestId: id };
  try {
    const r =
      body.action === 'take'
        ? await executeCommand(assignCommand, { ...ref, assignee: 'me' as const }, device.ctx, ports)
        : await executeCommand(updateCommand, { ...ref, action: body.action as never }, device.ctx, ports);
    return Response.json({ state: r.state });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
