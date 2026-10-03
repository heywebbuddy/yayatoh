import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { getVenueQuery, listQuoteRequestsQuery, type VenueDto } from '@yayatoh/venues';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { VenueForm } from '@/components/venue-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { zonesWith } from '@/lib/zones.ts';
import { loadConsole } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';
import { setQuoteStatusAction, setVenueArchivedAction, updateVenueAction } from '../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; venue: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale, org, venue: venueId } = await params;
  const { saved } = await searchParams;
  setRequestLocale(locale);
  if (!UUID.test(venueId)) notFound();
  const data = await loadConsole(org);
  let venue: VenueDto;
  try {
    venue = await executeQuery(getVenueQuery, { venueId }, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const t = await getTranslations('venues');
  const canWrite = roleCan(data.role, 'events:write');
  // Contact data: only people who can act on quotes see them.
  const quotes = canWrite ? await executeQuery(listQuoteRequestsQuery, { venueId }, data.ctx, ports) : null;
  const photos = await mediaPanel(data, 'venue', venue.id, 'photo');
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: venue.timezone,
  });
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/venues`} className="text-caption text-ink-2 underline underline-offset-2">
            {t('back')}
          </Link>
        }
        title={venue.name}
        description={[venue.city, venue.country].filter(Boolean).join(', ')}
        actions={
          <>
            {venue.directoryListed && !venue.archivedAt ? (
              <Link href={`/venues/${venue.slug}`} className={buttonClass('secondary')}>
                {t('viewPublic')}
              </Link>
            ) : null}
            {canWrite ? (
              <form action={setVenueArchivedAction.bind(null, org, venue.id, !venue.archivedAt)}>
                <Button type="submit" variant="secondary">
                  {venue.archivedAt ? t('restore') : t('archive')}
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      {saved ? <Alert tone="info" title={t('created')} /> : null}
      {venue.archivedAt ? <Alert tone="info" title={t('archivedNotice')} /> : null}
      <Card size="panel">
        <VenueForm
          action={updateVenueAction.bind(null, org, venue.id)}
          venue={venue}
          zones={zonesWith(venue.timezone)}
          defaultTimezone={venue.timezone}
          disabled={!canWrite}
        />
      </Card>
      <Card size="panel">
        <MediaUploader org={org} slot="photo" ticket={photos.ticket} items={photos.items} />
      </Card>
      <section aria-labelledby="quotes-heading" className="flex flex-col gap-3">
        <h2 id="quotes-heading" className="text-section">
          {t('quotes.title')}
        </h2>
        {quotes === null ? (
          <p className="text-body text-ink-2">{t('quotes.viewerNotice')}</p>
        ) : quotes.length === 0 ? (
          <EmptyState
            title={t('quotes.emptyTitle')}
            description={venue.directoryListed ? t('quotes.emptyListed') : t('quotes.emptyUnlisted')}
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {quotes.map((q) => (
              <li key={q.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{q.name}</h3>
                    <StatusDot
                      status={q.status === 'new' ? 'warning' : 'success'}
                      label={t(`quotes.status.${q.status}`)}
                    />
                  </div>
                  <p className="text-caption text-ink-2">
                    <a href={`mailto:${q.email}`} className="underline underline-offset-2">
                      {q.email}
                    </a>
                    {q.phone ? ` · ${q.phone}` : ''} · {when.format(q.createdAt)}
                  </p>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-ink-2">
                    {q.eventDate ? (
                      <div className="flex gap-1">
                        <dt>{t('quotes.eventDate')}:</dt>
                        <dd>{dateFmt.format(new Date(`${q.eventDate}T00:00:00Z`))}</dd>
                      </div>
                    ) : null}
                    {q.guests ? (
                      <div className="flex gap-1">
                        <dt>{t('quotes.guests')}:</dt>
                        <dd>{formatNumber(q.guests, locale)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="whitespace-pre-line text-body">{q.message}</p>
                  <form
                    action={setQuoteStatusAction.bind(
                      null,
                      org,
                      venue.id,
                      q.id,
                      q.status === 'new' ? 'handled' : 'new',
                    )}
                  >
                    <Button type="submit" variant="secondary" size="sm">
                      {q.status === 'new' ? t('quotes.markHandled') : t('quotes.markNew')}
                    </Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
