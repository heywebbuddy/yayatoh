import {
  markRsvpViewedCommand,
  publicRsvpQuery,
  publicRsvpQuestionsQuery,
  rsvpLinkRef,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { partySeatsQuery } from '@yayatoh/seating';
import { Alert, buttonClass, Card, EmptyState, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { submitRsvpAction } from './actions.ts';
import { HouseholdForm, type HouseholdGuest } from './household-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rsvp');
  // A party's page is theirs alone: never indexed, never followed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * A party's RSVP page (M4.1d, P4-2), mobile first: reached by its signed link (also printed as a
 * QR code) or through the paper fallback (name + PIN). One person answers for the household, for
 * the sub-events the party is invited to. After the deadline it is read-only ("contact the
 * hosts") unless the host reopened the party. The first open records `viewed`.
 */
export default async function RsvpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const ref = await rsvpLinkRef(token);
  if (!ref) notFound();
  const ctx = createCtx({ orgId: ref.orgId, locale });
  const view = await executeQuery(publicRsvpQuery, { token }, ctx, ports).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!view) notFound();
  // `viewed` on the first open; a read-only freeze (or any refusal) never stops the page.
  if (!view.viewed && view.state !== 'expired')
    await executeCommand(markRsvpViewedCommand, { token }, ctx, ports).catch((err) => {
      if (!isDomainError(err)) throw err;
    });
  // M4.1e: the hosts' questions (nothing private comes back, only that it was given).
  const questions =
    view.state === 'open' ? await executeQuery(publicRsvpQuestionsQuery, { token }, ctx, ports) : null;
  // M4.4a: once the hosts open the seat finder and seat the party, the page leads to its table.
  const seats =
    view.state === 'expired'
      ? null
      : await executeQuery(partySeatsQuery, { token }, ctx, ports).catch((err) => {
          if (isDomainError(err)) return null;
          throw err;
        });
  const seated = seats?.state === 'open' && seats.charts.some((c) => c.places.length > 0);
  const { thanks } = await searchParams;
  const t = await getTranslations('rsvp');
  const tHub = await getTranslations('hub');

  const when = (start: Date, end: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: view.timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).formatRange(start, end);
  const deadline = view.deadline
    ? new Intl.DateTimeFormat(locale, {
        timeZone: view.timezone,
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(view.deadline)
    : null;
  const byId = new Map(view.guests.map((g) => [g.id, g]));
  const label = (id: string) => {
    const g = byId.get(id);
    if (!g) return '';
    const full = [g.firstName, g.lastName].filter(Boolean).join(' ');
    return full || t('guestOf', { name: g.hostFirstName ?? '' });
  };
  const guests: HouseholdGuest[] = view.guests.map((g) => ({ id: g.id, label: label(g.id) }));
  const answers = Object.fromEntries(view.responses.map((r) => [`${r.subEventId}:${r.guestId}`, r.status]));

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader
        eyebrow={<Label>{view.eventName}</Label>}
        title={view.state === 'expired' ? t('expiredTitle') : t('title', { party: view.partyName })}
        description={
          view.state === 'expired'
            ? t('expired')
            : view.state === 'locked'
              ? undefined
              : deadline
                ? t('introDeadline', { deadline })
                : t('intro')
        }
      />
      {thanks === '1' && view.state !== 'expired' ? (
        <Alert tone="success" title={t('thanksTitle')}>
          {view.state === 'open' && deadline ? t('thanksChange', { deadline }) : t('thanks')}
        </Alert>
      ) : null}
      {seated ? (
        <Card size="panel" className="flex flex-col gap-2" data-testid="rsvp-seat">
          <h2 className="m-0 text-section text-ink">{t('seatTitle')}</h2>
          <p className="m-0 text-body text-ink-2">{t('seatHint')}</p>
          <Link
            href={`/rsvp/${encodeURIComponent(token)}/seat`}
            className={buttonClass('primary', 'md', 'self-start')}
          >
            {t('seatLink')}
          </Link>
        </Card>
      ) : null}
      {view.state === 'locked' ? (
        <>
          <Alert tone="info" title={t('lockedTitle')}>
            {t('locked')}
          </Alert>
          {view.subEvents.length ? (
            <section aria-labelledby="rsvp-answers" className="flex flex-col gap-3">
              <h2 id="rsvp-answers" className="m-0 text-section text-ink">
                {t('yourAnswers')}
              </h2>
              {view.subEvents.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 elevation-card glass"
                >
                  <div className="flex flex-col gap-1">
                    <h3 className="m-0 text-card text-ink">{s.name}</h3>
                    <p className="m-0 text-caption font-semibold text-ink-2">
                      {[when(s.startsAt, s.endsAt), s.place].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-0 pt-3">
                    {s.guestIds.map((id) => {
                      const a = answers[`${s.id}:${id}`];
                      return (
                        <li
                          key={id}
                          className="flex min-h-6 flex-wrap items-center gap-x-1 text-body text-ink"
                        >
                          <span className="font-bold">{label(id)}:</span>{' '}
                          <StatusPill
                            tone={a === 'attending' ? 'success' : a === 'declined' ? 'neutral' : 'waiting'}
                            label={a ? t(a) : t('noAnswer')}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : view.state === 'open' ? (
        view.subEvents.length === 0 ? (
          <EmptyState title={t('nothingTitle')} description={t('nothing')} />
        ) : (
          <>
            {view.respondedAt && thanks !== '1' ? (
              <p role="status" className="m-0 text-body font-semibold text-ink-2">
                {t('answeredOn', {
                  date: new Intl.DateTimeFormat(locale, {
                    timeZone: view.timezone,
                    dateStyle: 'long',
                  }).format(view.respondedAt),
                })}
              </p>
            ) : null}
            <HouseholdForm
              action={submitRsvpAction.bind(null, token)}
              guests={guests}
              subEvents={view.subEvents.map((s) => ({
                id: s.id,
                name: s.name,
                when: [when(s.startsAt, s.endsAt), s.place].filter(Boolean).join(' · '),
                guestIds: s.guestIds,
              }))}
              answers={answers}
              plusOnes={view.guests
                .filter((g) => g.kind === 'plus_one')
                .map((g) => ({
                  guestId: g.id,
                  hostName: g.hostFirstName ?? '',
                  firstName: g.firstName ?? '',
                  lastName: g.lastName ?? '',
                }))}
              questions={
                questions?.questions.length
                  ? { questions: questions.questions, menu: questions.menu, guests: questions.guests }
                  : undefined
              }
            />
          </>
        )
      ) : null}
      {view.state !== 'expired' ? (
        <p className="m-0">
          <Link
            href={`/hub/${encodeURIComponent(token)}`}
            className="inline-flex min-h-11 items-center font-bold text-primary-ink underline underline-offset-2"
          >
            {tHub('openHub')}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
