import { partyCardTarget, publicGiving } from '@yayatoh/donations';
import { rsvpLinkRef } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { partySeatsQuery } from '@yayatoh/seating';
import { buttonClass, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuestPlaces } from '@/components/guest-places.tsx';
import { VenueGuide } from '@/components/venue-guide.tsx';
import { VenueMap } from '@/components/venue-map.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('partySeats');
  // A party's page is theirs alone: never indexed, never followed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * A party's seat page (M4.4a, P4-3 d), `/rsvp/{token}/seat`: reached by the party's own link (the
 * QR code on its invitation, escort or place card; it never changes when the host moves the
 * party, so the printed code is permanent). The party's tables on every chart it is on, each
 * highlighted on the venue map, and its tablemates as the host named them: the only seat finder
 * page that ever shows a name, because only the party's own link reaches it. Until the organizer
 * opens the seat finder it says the seating isn't ready yet.
 */
export default async function PartySeatPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const ref = await rsvpLinkRef(token);
  if (!ref) notFound();
  const view = await executeQuery(
    partySeatsQuery,
    { token },
    createCtx({ orgId: ref.orgId, locale }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!view) notFound();
  const t = await getTranslations('partySeats');
  const tg = await getTranslations('guestSeats');
  const person = (p: { name: string | null; guestOf: string | null }) =>
    p.name ?? t('guestOf', { name: p.guestOf ?? '' });
  const seated = view.charts.some((c) => c.places.length > 0);
  // M4.8e: at a gala taking gifts, the place card's QR also offers saving a card for the night.
  const party = await partyCardTarget(ref.orgId, token);
  const giving = party ? await publicGiving(ref.orgId, party.eventId) : null;
  const cardOpen = Boolean(giving?.available && giving.campaigns.length);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader
        eyebrow={<Label>{view.eventName}</Label>}
        title={t('title', { party: view.partyName })}
        description={view.state === 'open' && seated ? t('intro') : undefined}
      />
      {view.state === 'closed' ? (
        <EmptyState title={t('closedTitle')} description={t('closed')} />
      ) : !seated ? (
        <EmptyState title={t('noChartsTitle')} description={t('noCharts')} />
      ) : null}
      {view.state === 'open'
        ? view.charts.map((c, i) => {
            const id = `party-chart-${i}`;
            const name = c.name ?? tg('wholeEvent');
            return (
              <section key={c.subEventId ?? 'plan'} aria-labelledby={id} className="flex flex-col gap-3">
                <h2 id={id} className="m-0 text-section text-ink">
                  {view.charts.length > 1 ? name : tg('resultTitle', { count: c.places.length || 1 })}
                </h2>
                {c.places.length ? (
                  <GuestPlaces
                    doc={c.doc}
                    places={c.places}
                    labelledBy={id}
                    detail={(p) => {
                      const place = c.places.find((x) => x.itemId === p.itemId);
                      if (!place) return null;
                      return (
                        <dl className="m-0 mt-2 flex flex-col gap-2 border-t border-line pt-2 text-body">
                          <div>
                            <dt className="text-caption font-bold text-ink-2">{t('yourParty')}</dt>
                            <dd className="m-0 text-ink" data-testid="party-guests">
                              {place.guests.map(person).join(', ')}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-caption font-bold text-ink-2">
                              {t(`tablemates.${p.itemKind}`)}
                            </dt>
                            <dd className="m-0 text-ink" data-testid="tablemates">
                              {place.tablemates.length ? (
                                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                                  {place.tablemates.map((m, j) => (
                                    // Names can repeat (two unnamed plus-ones of one guest): keyed by place.
                                    <li key={j}>{person(m)}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-ink-2">{t('noTablemates')}</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      );
                    }}
                  />
                ) : (
                  <p className="m-0 text-body text-ink-2">{tg('noTable')}</p>
                )}
                {c.places.length && c.unseated.length ? (
                  <p className="m-0 text-body text-ink-2">
                    {t('unseated', { names: c.unseated.map(person).join(', ') })}
                  </p>
                ) : null}
                {c.places.length ? (
                  <div className="flex flex-col gap-3">
                    <h3 className="m-0 text-card text-ink">
                      {view.charts.length > 1 ? tg('mapFor', { name }) : tg('mapTitle')}
                    </h3>
                    <VenueMap doc={c.doc} highlightItems={c.places.map((p) => p.itemId)} />
                    <VenueGuide
                      doc={c.doc}
                      highlightItems={c.places.map((p) => p.itemId)}
                      headingId={`${id}-guide`}
                      headingLevel={3}
                    />
                  </div>
                ) : null}
              </section>
            );
          })
        : null}
      {cardOpen ? (
        <Link
          href={`/rsvp/${encodeURIComponent(token)}/card`}
          className={buttonClass('primary', 'lg', 'self-start')}
        >
          {t('saveCard')}
        </Link>
      ) : null}
      <p className="m-0 text-caption text-ink-2">{t('keep')}</p>
      <Link
        href={`/rsvp/${encodeURIComponent(token)}`}
        className="inline-flex min-h-6 items-center self-start text-caption text-ink-2 underline"
      >
        {t('toRsvp')}
      </Link>
    </main>
  );
}
