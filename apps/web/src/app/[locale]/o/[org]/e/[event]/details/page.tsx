import { eventDetailsQuery, shortLinksQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { Button, Card, PageHeader } from '@yayatoh/ui';
import { listVenuesQuery } from '@yayatoh/venues';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EventDetailsForm, VanityForm } from '@/components/event-details-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { ensureShortLinkAction, saveDetailsAction, setVanityAction } from './actions.ts';

export default async function EventDetailsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'details');
  const t = await getTranslations('details');
  const canWrite = can('events:write');
  const [details, venues, links] = await Promise.all([
    executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listVenuesQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(shortLinksQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  // The picked venue stays listed even if it was archived since.
  const options =
    details.venueId && !venues.some((v) => v.id === details.venueId)
      ? [{ id: details.venueId, name: details.venueName ?? '—', city: details.city }, ...venues]
      : venues;
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const auto = links.find((l) => l.kind === 'auto');
  const vanity = links.find((l) => l.kind === 'vanity');
  const live = ['published', 'postponed', 'cancelled', 'completed'].includes(ev.status);
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}
      <Card size="panel">
        <EventDetailsForm
          action={saveDetailsAction.bind(null, org, event)}
          details={details}
          visibility={ev.visibility}
          venues={options}
          disabled={!canWrite}
        />
        {canWrite && venues.length === 0 ? (
          <p className="pt-3 text-caption text-ink-2">
            {t.rich('noVenuesYet', {
              link: (chunks) => (
                <Link href={`/o/${org}/venues`} className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}
      </Card>
      <section aria-labelledby="short-links-heading" className="flex flex-col gap-3">
        <h2 id="short-links-heading" className="text-section">
          {t('shortLinks')}
        </h2>
        <Card size="panel" className="flex flex-col gap-4">
          <p className="text-body text-ink-2">{live ? t('shortLinksLive') : t('shortLinksDraft')}</p>
          <dl className="flex flex-col gap-2">
            {[auto, vanity].filter(Boolean).map((l) =>
              l ? (
                <div key={l.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <dt className="text-caption text-ink-2">{t(`kind.${l.kind}`)}</dt>
                  <dd className="m-0 font-mono text-body break-all" data-testid={`short-link-${l.kind}`}>
                    {`${origin}/e/${l.code}`}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
          {!auto && canWrite ? (
            <form action={ensureShortLinkAction.bind(null, org, event)}>
              <Button type="submit" variant="secondary">
                {t('createShortLink')}
              </Button>
            </form>
          ) : null}
          {canWrite ? (
            <VanityForm
              action={setVanityAction.bind(null, org, event)}
              current={vanity?.code ?? null}
              origin={origin}
            />
          ) : null}
        </Card>
      </section>
    </>
  );
}
