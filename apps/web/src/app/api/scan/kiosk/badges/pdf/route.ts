import { kioskJobBadgeQuery } from '@yayatoh/badges';
import { executeQuery } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { pdfResponse, renderOr503 } from '@/server/badge-pdf.ts';
import { ports } from '@/server/ports.ts';
import { scanDevice } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The badge PDF of a print the kiosk just made (M5.5c), for the kiosk's own print dialog. Device
 * token plus the job's signed token (this kiosk, 30 minutes); fetched by the kiosk, never linked.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const q = new URL(req.url).searchParams;
  const eventId = q.get('eventId') ?? '';
  const token = q.get('token') ?? '';
  if (!UUID.test(eventId) || !token) return problemResponse(problem('validation_failed', 'eventId'));
  let html: string;
  try {
    ({ html } = await executeQuery(kioskJobBadgeQuery, { eventId, token }, device.ctx, ports));
  } catch (err) {
    return problemResponse(problemFor(err));
  }
  return renderOr503(html, (pdf) => pdfResponse(pdf, 'badge.pdf', 'inline'));
}
