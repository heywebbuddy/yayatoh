import { recordPaddlesCommand } from '@yayatoh/donations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * A spotter's phone syncing its queued paddle entries (M4.8c). The org and event come from the
 * path and the member's session, never a header. JSON only and same-origin only (a cross-site
 * form can't post it). Each entry carries the device's own id, so a batch sent again after a lost
 * answer is recorded once; the answer lists every entry's outcome.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string }> },
) {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json'))
    return json({ code: 'validation_failed' }, 415);
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  if ((site && site !== 'same-origin') || (origin && new URL(origin).host !== new URL(req.url).host))
    return json({ code: 'forbidden' }, 403);
  if (!(await getSession())) return json({ code: 'unauthorized' }, 401);
  const { org, event } = await params;
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const body = (await req.json().catch(() => null)) as { entries?: unknown } | null;
  try {
    const r = await executeCommand(
      recordPaddlesCommand,
      { eventId: ev.id, entries: body?.entries },
      data.ctx,
      ports,
    );
    return json(r);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const status = err.code === 'forbidden' ? 403 : err.code === 'not_found' ? 404 : 400;
    return json({ code: err.code }, status);
  }
}
