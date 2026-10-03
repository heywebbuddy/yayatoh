import { createHash } from 'node:crypto';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { appTokenSecret } from '@yayatoh/platform';
import { calendarFeedIcs, calendarFeedQuery, calendarFeedTarget } from '@yayatoh/registration';
import { ports } from '@/server/ports.ts';

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });

/**
 * A registrant's personal calendar feed (M5.10a): their enrolled sessions (confirmed) and
 * favorites (tentative), as a subscribable iCalendar feed. The signed link is the credential (its
 * org comes from the signature, never a header); a replaced link, a cancelled registration or an
 * org that is not live gets a 404. Calendar apps poll it: an unchanged feed answers 304.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = decodeURIComponent((await params).token).replace(/\.ics$/, '');
  const target = await calendarFeedTarget(raw, appTokenSecret());
  if (!target) return notFound();
  let body: string;
  try {
    const feed = await executeQuery(
      calendarFeedQuery,
      { registrantId: target.registrantId, version: target.version },
      createCtx({ orgId: target.orgId }),
      ports,
    );
    body = calendarFeedIcs({
      calendarName: feed.eventName,
      timezone: feed.timezone,
      sessions: feed.sessions,
    });
  } catch (err) {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled'))
      return notFound();
    throw err;
  }
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  const headers = {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename="schedule.ics"',
    // Personal: never in a shared cache; calendar apps revalidate with the ETag.
    'cache-control': 'private, no-cache',
    etag,
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
