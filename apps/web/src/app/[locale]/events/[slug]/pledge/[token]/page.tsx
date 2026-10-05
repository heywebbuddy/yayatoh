import { randomUUID } from 'node:crypto';
import { catchUpGifts, pledgeOutcomesSubscriber, publicPledge } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { catchUpSubscriber } from '@yayatoh/platform';
import { Alert, Button, Input, Label, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/server/locale.ts';
import { GiveFrame, GiveHero, giveCard } from '../../give/give-frame.tsx';
import { payPledgeAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pledgePay');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const KNOWN_ERRORS = ['charging', 'settled', 'rate_limited', 'not_connected'];

/**
 * A donor's pledge (M4.8e, P4-12), by the signed link in their summary, invoice and reminders:
 * the amount and what happens next (the card charge and its time, or the due date), with one
 * action: pay now (also "pay another way" before the card is charged). Nothing about other donors.
 */
export default async function PledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, slug, token: raw } = await params;
  pageLocale(locale);
  const token = decodeURIComponent(raw);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  // Dev and e2e have no worker: settle what was just paid before showing it.
  await catchUpGifts(target.orgId);
  await catchUpSubscriber(pledgeOutcomesSubscriber, target.orgId);
  const p = await publicPledge(target.orgId, token);
  if (!p || p.eventId !== target.eventId) notFound();
  const t = await getTranslations('pledgePay');
  const { error } = await searchParams;
  const amount = formatMoney(money(p.amountMinor, p.currency), locale);
  const when = (d: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: p.timeZone }).format(
      d,
    );
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const settled = p.status === 'paid' || p.status === 'paid_offline' || p.status === 'written_off';
  const tone =
    p.status === 'paid' || p.status === 'paid_offline' ? 'success' : settled ? 'neutral' : 'waiting';
  return (
    <GiveFrame organizer={ev.organizerName}>
      <GiveHero>
        <Label tone="inverse">{ev.name}</Label>
        <h1 className="m-0 text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] md:text-title">
          {t('title', { amount })}
        </h1>
        <p className="m-0 text-[15px] leading-relaxed text-white/90">
          {t('subtitle', { level: p.levelName, campaign: p.campaignName })}
        </p>
      </GiveHero>
      <section className={giveCard} aria-labelledby="pledge-state">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="pledge-state" className="m-0 text-card text-ink">
            {t('stateTitle')}
          </h2>
          <StatusPill tone={tone} label={t(`status.${p.status}`)} />
        </div>
        {error && error !== 'email' && error !== 'no_email' ? (
          <Alert title={KNOWN_ERRORS.includes(error) ? t(`errors.${error}`) : t('errors.generic')} />
        ) : null}
        {p.status === 'scheduled' && p.card && p.chargeAt ? (
          <p className="m-0 text-body text-ink">
            {t('cardScheduled', {
              brand: p.card.brand ?? t('card'),
              last4: p.card.last4 ?? '',
              when: when(p.chargeAt),
            })}
          </p>
        ) : null}
        {p.status === 'charging' ? <p className="m-0 text-body text-ink">{t('charging')}</p> : null}
        {p.status === 'invoiced' && p.dueOn ? (
          <p className="m-0 text-body text-ink">{t('due', { date: day(p.dueOn) })}</p>
        ) : null}
        {p.status === 'paid' || p.status === 'paid_offline' ? (
          <Alert tone="success" title={t('thanks')} />
        ) : null}
        {p.status === 'written_off' ? <p className="m-0 text-body text-ink">{t('closed')}</p> : null}
        {p.status === 'scheduled' || p.status === 'invoiced' ? (
          <form
            action={payPledgeAction.bind(null, slug, token, randomUUID())}
            noValidate
            className="flex flex-col gap-4"
          >
            {p.needsEmail ? (
              <Input
                name="email"
                type="email"
                label={t('email')}
                hint={t('emailHint')}
                autoComplete="email"
                required
                fieldSize="lg"
                error={error === 'email' || error === 'no_email' ? t(`errors.${error}`) : undefined}
              />
            ) : null}
            <Button type="submit" size="lg" className="w-full">
              {p.status === 'scheduled' ? t('payAnotherWay', { amount }) : t('payNow', { amount })}
            </Button>
          </form>
        ) : null}
        {p.status === 'scheduled' ? (
          <p className="m-0 text-caption text-ink-2">{t('anotherWayHint')}</p>
        ) : null}
      </section>
    </GiveFrame>
  );
}
