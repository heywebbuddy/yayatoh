import {
  KIOSK_CODE_TTL_MS,
  kioskLookupQuery,
  kioskPrintCommand,
  kioskSnapshotQuery,
  kioskVerifyCodeCommand,
} from '@yayatoh/badges';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { routing } from '@/i18n/routing.ts';
import { sendGuestEmail } from '@/server/guest.ts';
import { kioskRequestCode } from '@/server/kiosk-print.ts';
import { ports } from '@/server/ports.ts';
import { sendPrintJobNow } from '@/server/printing.ts';
import { limitRequest } from '@/server/rate-limit.ts';
import { scanDevice } from '@/server/scan-staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_STORE = { 'cache-control': 'no-store' };
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const localeOf = (v: unknown) =>
  (routing.locales as readonly string[]).includes(String(v)) ? String(v) : routing.defaultLocale;

/**
 * Kiosk self-print (M5.5c). Device token only: the kiosk's offline snapshot (GET), and (POST) one
 * attendee at a time — identify by the ticket's code (`lookup`), or by a code emailed to the
 * ticket's holder (`email`, then `verify`), then `print` once. Every answer is the command's
 * allowlisted output; an emailed code is never in a response.
 */
export async function GET(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  const eventId = new URL(req.url).searchParams.get('eventId') ?? '';
  if (!UUID.test(eventId)) return problemResponse(problem('validation_failed', 'eventId'));
  try {
    return Response.json(await executeQuery(kioskSnapshotQuery, { eventId }, device.ctx, ports), {
      headers: NO_STORE,
    });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function POST(req: Request) {
  const device = await scanDevice(req);
  if (device instanceof Response) return device;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return problemResponse(problem('validation_failed', 'Invalid JSON'));
  }
  const eventId = str(body.eventId) ?? '';
  try {
    switch (body.action) {
      case 'lookup':
        return Response.json(
          await executeQuery(kioskLookupQuery, { eventId, code: str(body.code) ?? '' }, device.ctx, ports),
          { headers: NO_STORE },
        );
      case 'email': {
        const email = (str(body.email) ?? '').trim().toLowerCase();
        const decision = await limitRequest(req, 'guestCode', { identity: email, scope: 'kiosk' });
        if (!decision.allowed) return problemResponse(problem('rate_limited', 'Too many codes'));
        const r = await executeCommand(kioskRequestCode, { eventId, email }, device.ctx, ports);
        if (r.send)
          await sendGuestEmail({
            kind: 'badges.kiosk-code',
            to: r.send.to,
            locale: localeOf(body.locale),
            orgId: device.ctx.orgId ?? null,
            params: { code: r.send.code, eventName: r.eventName, minutes: KIOSK_CODE_TTL_MS / 60_000 },
          });
        // The same answer whether or not anything was sent.
        return Response.json({ challengeId: r.challengeId }, { headers: NO_STORE });
      }
      case 'verify':
        return Response.json(
          await executeCommand(
            kioskVerifyCodeCommand,
            { eventId, challengeId: str(body.challengeId) ?? '', code: str(body.code) ?? '' },
            device.ctx,
            ports,
          ),
          { headers: NO_STORE },
        );
      case 'print': {
        const r = await executeCommand(
          kioskPrintCommand,
          {
            eventId,
            ticketId: str(body.ticketId) ?? '',
            ...(str(body.pass) ? { pass: str(body.pass) } : {}),
            ...(str(body.code) ? { code: str(body.code) } : {}),
            requestKey: str(body.requestKey) ?? '',
            locale: localeOf(body.locale),
          },
          device.ctx,
          ports,
        );
        // PrintNode: hand the job over now (a failure is logged on the job; the desk sees it).
        if (r.status === 'printing' && r.queued) {
          const sent = await sendPrintJobNow(device.ctx, r.jobId);
          return Response.json(
            { ...r, queued: false, failed: sent.status === 'failed' },
            { headers: NO_STORE },
          );
        }
        return Response.json(r, { headers: NO_STORE });
      }
      default:
        return problemResponse(problem('validation_failed', 'action'));
    }
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
