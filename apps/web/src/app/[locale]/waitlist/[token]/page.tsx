import { publicForm } from '@yayatoh/forms';
import { formatMoney, money } from '@yayatoh/kernel';
import { publicWaitlistEntry } from '@yayatoh/orders';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { WaitlistButtonForm, WaitlistOfferForm } from '@/components/waitlist-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import {
  declineOfferAction,
  leaveWaitlistAction,
  offerCheckoutAction,
  rejoinWaitlistAction,
} from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('waitlist');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * The person's own waitlist link (M3.10a), from the join page or their email: their place in line,
 * an open offer to check out (held until a time shown in the event's timezone), leave, and rejoin
 * after an expired or declined offer. The signed link is the credential; nothing else is shown.
 */
export default async function WaitlistEntryPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const view = await publicWaitlistEntry(token);
  if (!view) notFound();
  const t = await getTranslations('waitlist');
  const tz = view.event.timezone;
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const questions = view.offer
    ? ((
        await publicForm(view.orgId, {
          kind: 'checkout_questions',
          subjectType: 'event',
          subjectId: view.eventId,
        })
      )?.fields ?? [])
    : [];
  const summary = t('summary', { count: view.quantity, pass: view.pass.name });
  const state = (title: string, body: string, extra?: ReactNode) => (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{title}</h2>
      <p role="status" className="text-body text-ink-2">
        {body}
      </p>
      {extra}
    </Card>
  );
  const leave = <WaitlistButtonForm action={leaveWaitlistAction.bind(null, token)} label={t('leave')} />;
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{t('eyebrow', { org: view.orgName })}</Label>}
        title={view.event.name}
        description={
          view.date ? t('forDate', { summary, date: dateTime.format(view.date.startsAt) }) : summary
        }
      />
      {view.status === 'waiting' ? (
        state(t('waitingTitle', { position: view.position ?? 1 }), t('waiting'), leave)
      ) : view.offer ? (
        <section aria-labelledby="offer-heading" className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <h2 id="offer-heading" className="text-section">
              {t('offerTitle', { count: view.offer.quantity, pass: view.pass.name })}
            </h2>
            <p role="status" className="text-body text-ink-2">
              {t('offerUntil', { until: dateTime.format(view.offer.expiresAt) })}
            </p>
            <p className="text-body text-ink-2">
              {t('priceEach', {
                price: formatMoney(money(view.offer.unitAllInMinor, view.event.currency), locale),
              })}
            </p>
          </Card>
          <WaitlistOfferForm
            action={offerCheckoutAction.bind(null, token)}
            quantity={view.offer.quantity}
            minPerOrder={view.pass.minPerOrder}
            name={view.name}
            email={view.email}
            questions={questions}
          />
          <WaitlistButtonForm action={declineOfferAction.bind(null, token)} label={t('decline')} />
        </section>
      ) : view.status === 'accepted' ? (
        state(t('acceptedTitle'), t('accepted'))
      ) : view.canRejoin ? (
        state(
          view.status === 'declined' ? t('declinedTitle') : t('expiredTitle'),
          view.status === 'declined' ? t('declined') : t('expired'),
          <WaitlistButtonForm
            action={rejoinWaitlistAction.bind(null, token)}
            label={t('rejoin')}
            variant="primary"
          />,
        )
      ) : (
        state(t('endedTitle'), view.status === 'removed' ? t('removed') : t('left'))
      )}
      <Link href={`/events/${view.event.slug}`} className="self-start text-body underline underline-offset-2">
        {t('backToEvent')}
      </Link>
    </main>
  );
}
