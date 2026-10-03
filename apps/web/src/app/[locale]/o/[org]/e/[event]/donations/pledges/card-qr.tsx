import { publicGiving } from '@yayatoh/donations';
import { qrPath } from '@yayatoh/pdf';
import { Card, CardHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';

/**
 * The card-saving QR code (M4.8e, P4-14): guests scan it with their own phone at check-in (`src`
 * checkin) or from a table card (`table`) and save a card for tonight's giving. Server-rendered
 * (one SVG path, no client JS); the address is printed under it as text. Only while the org takes
 * gifts online and a campaign is open.
 */
export async function CardSavingQr({
  orgId,
  eventId,
  slug,
  source,
}: {
  orgId: string;
  eventId: string;
  slug: string;
  source: 'checkin' | 'table';
}) {
  const giving = await publicGiving(orgId, eventId);
  if (!giving.available || giving.campaigns.length === 0) return null;
  const t = await getTranslations('pledges.qr');
  // The locale-neutral address: the phone's own language decides the page's (proxy).
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const url = `${origin}/events/${slug}/card?src=${source}`;
  const { size, d } = qrPath(url);
  return (
    <Card className="flex flex-col gap-3" data-testid={`card-qr-${source}`}>
      <CardHeader as="h2" title={t(`${source}Title`)} />
      <p className="m-0 text-body text-ink-2">{t(`${source}Body`)}</p>
      <div className="flex flex-wrap items-center gap-4">
        <svg
          role="img"
          aria-label={t('label')}
          viewBox={`0 0 ${size} ${size}`}
          shapeRendering="crispEdges"
          className="size-40 shrink-0 rounded-tile border border-line text-ink"
        >
          <rect width={size} height={size} fill="white" />
          <path d={d} fill="currentColor" />
        </svg>
        <a href={url} className="min-w-0 break-all text-caption text-primary underline">
          {url}
        </a>
      </div>
    </Card>
  );
}
