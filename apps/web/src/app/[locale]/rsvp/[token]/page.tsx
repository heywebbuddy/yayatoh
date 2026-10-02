import {
  markRsvpViewedCommand,
  publicRsvpQuery,
  publicRsvpQuestionsQuery,
  rsvpLinkRef,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
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
  const { thanks } = await searchParams;
  const t = await getTranslations('rsvp');

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
        <Alert tone="info" title={t('thanksTitle')}>
          {view.state === 'open' && deadline ? t('thanksChange', { deadline }) : t('thanks')}
        </Alert>
      ) : null}
      {view.state === 'locked' ? (
        <>
          <Alert tone="info" title={t('lockedTitle')}>
            {t('locked')}
          </Alert>
          {view.subEvents.length ? (
            <section aria-labelledby="rsvp-answers" className="flex flex-col gap-3">
              <h2 id="rsvp-answers" className="text-section">
                {t('yourAnswers')}
              </h2>
              {view.subEvents.map((s) => (
                <Card key={s.id} className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">{s.name}</h3>
                  <p className="text-caption text-zinc-600">
                    {[when(s.startsAt, s.endsAt), s.place].filter(Boolean).join(' · ')}
                  </p>
                  <ul className="flex list-none flex-col gap-1 p-0">
                    {s.guestIds.map((id) => {
                      const a = answers[`${s.id}:${id}`];
                      return (
                        <li key={id} className="text-body">
                          {label(id)}: {a ? t(a) : t('noAnswer')}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
            </section>
          ) : null}
        </>
      ) : view.state === 'open' ? (
        view.subEvents.length === 0 ? (
          <Card className="flex flex-col gap-2">
            <h2 className="text-section">{t('nothingTitle')}</h2>
            <p className="text-body text-zinc-700">{t('nothing')}</p>
          </Card>
        ) : (
          <>
            {view.respondedAt && thanks !== '1' ? (
              <p role="status" className="text-body text-zinc-700">
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
    </main>
  );
}
