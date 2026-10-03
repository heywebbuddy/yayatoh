import { guestSnapshotQuery, recordGuestArrivalsCommand } from '@yayatoh/checkin';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { checkinCardEntry } from '@/server/saved-card.ts';
import { scanDevice } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The guest snapshot of the device's event (M4.4b): names, party labels and tables for check-in by
 * name or party, the guest kiosk and the A–Z board, offline too. Device token only (the token
 * decides the org); an allowlist with no contact detail, meal or private answer.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const eventId = new URL(req.url).searchParams.get('eventId') ?? '';
  if (!UUID.test(eventId)) return problemResponse(problem('validation_failed', 'eventId'));
  try {
    const snapshot = await executeQuery(guestSnapshotQuery, { eventId }, device.ctx, ports);
    // M4.8e: while the event takes gifts, the card-saving code shown after a guest arrives.
    const card = device.ctx.orgId ? await checkinCardEntry(device.ctx.orgId, eventId) : null;
    return Response.json({ ...snapshot, card }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

/** The device's guest check-ins (offline ones too): idempotent per check-in, first wins. */
export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  try {
    return Response.json(await executeCommand(recordGuestArrivalsCommand, body as never, device.ctx, ports));
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
