import { GUEST_PASS_PLATFORMS, type GuestPassPlatform, guestPassContent } from '@yayatoh/guests';
import { getTranslations } from 'next-intl/server';
import { guestPassProvider, hubPath, loadPartyHub } from '@/server/guest-hub.ts';
import { appOrigin } from '@/server/tenant-return.ts';

const isPlatform = (v: string): v is GuestPassPlatform =>
  (GUEST_PASS_PLATFORMS as readonly string[]).includes(v);

/**
 * The party's wallet pass (M4.7a): built from the hub's allowlisted payload (event, party, when,
 * where, seats once shared; never private answers), issued by the pass provider (the fake one
 * until the owner's Apple and Google accounts exist, M1.5e2). Its QR code opens the party's hub,
 * so resetting the link retires the pass's code too. Unknown, reset or expired links get nothing.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; token: string; platform: string }> },
) {
  const { locale, token: raw, platform } = await params;
  if (!isPlatform(platform)) return new Response('Not found', { status: 404 });
  const token = decodeURIComponent(raw);
  const hub = await loadPartyHub(token, locale);
  if (hub?.state !== 'ok') return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale, namespace: 'hub' });
  const content = guestPassContent({
    serial: hub.passSerial,
    eventName: hub.eventName,
    partyName: hub.partyName,
    timezone: hub.timezone,
    startsAt: hub.startsAt,
    endsAt: hub.endsAt,
    program: hub.program,
    seats: hub.seating?.seats ?? [],
  });
  const r = await guestPassProvider.issuePass({
    platform,
    content,
    barcode: `${appOrigin().replace(/\/$/, '')}${hubPath(token, locale)}`,
    locale,
    labels: { party: t('pass.party'), when: t('pass.when'), place: t('pass.place'), seats: t('pass.seats') },
    when: new Intl.DateTimeFormat(locale, {
      timeZone: content.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(content.relevantAt),
  });
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (r.kind === 'redirect')
    return new Response(null, { status: 303, headers: { ...headers, location: r.url } });
  if (r.kind === 'unavailable') return new Response('Not available', { status: 503, headers });
  return new Response(r.body, {
    headers: {
      ...headers,
      'content-type': r.contentType,
      'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]/g, '_')}"`,
    },
  });
}
