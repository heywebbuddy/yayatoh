import type { ContactStatsDto, ContactValueDto } from '@yayatoh/crm';
import {
  ENGAGEMENT_HALF_POINTS,
  ENGAGEMENT_WEIGHTS,
  engagementPoints,
  NO_SHOW_PRIOR,
} from '@yayatoh/crm/client';
import { formatMoney, money } from '@yayatoh/kernel';
import { Card, CardLabel } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/** A rate in basis points as a locale percent with one decimal (1 429 → "14.3%"). */
export const formatBps = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bps / 10_000);

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card>
      <div className="flex flex-col gap-1">
        <CardLabel>{label}</CardLabel>
        <p className="text-[28px] font-light tracking-[-0.03em]" data-testid={testId}>
          {value}
        </p>
      </div>
    </Card>
  );
}

/**
 * The contact page's stats (M6.1b): counts, first and last seen, lifetime value (only when the
 * member can read finance: `value` is null otherwise and nothing about money renders), and the
 * scores with their formulas written out, so every number can be checked by hand.
 */
export async function ContactStatsPanel({
  stats: s,
  value,
  locale,
  timezone,
}: {
  stats: ContactStatsDto;
  value: ContactValueDto | null;
  locale: string;
  timezone: string;
}) {
  const t = await getTranslations('contactStats');
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone });
  const points = engagementPoints({
    eventsAttended: s.eventsAttended,
    sessionsAttended: s.sessionsAttended,
    campaignsOpened: s.campaignsOpened,
  });
  return (
    <>
      <section aria-labelledby="glance-heading" className="flex flex-col gap-3">
        <h2 id="glance-heading" className="text-section">
          {t('glance')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('events')} value={nf.format(s.eventsRegistered)} testId="stat-events" />
          <Stat label={t('attended')} value={nf.format(s.eventsAttended)} testId="stat-attended" />
          <Stat label={t('sessions')} value={nf.format(s.sessionsAttended)} testId="stat-sessions" />
          <Stat label={t('campaigns')} value={nf.format(s.campaignsOpened)} testId="stat-campaigns" />
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-ink-2">{t('firstSeen')}</dt>
            <dd data-testid="stat-first-seen">{s.firstSeenAt ? df.format(s.firstSeenAt) : t('never')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">{t('lastSeen')}</dt>
            <dd data-testid="stat-last-seen">{s.lastSeenAt ? df.format(s.lastSeenAt) : t('never')}</dd>
          </div>
        </dl>
      </section>

      {value ? (
        <section aria-labelledby="value-heading" className="flex flex-col gap-3">
          <h2 id="value-heading" className="text-section">
            {t('lifetimeValue')}
          </h2>
          {value.lifetime.length === 0 ? (
            <p className="text-body text-ink-2">{t('noSpend')}</p>
          ) : (
            <ul className="flex list-none flex-col gap-1 p-0" data-testid="stat-ltv">
              {value.lifetime.map((v) => (
                <li key={v.currency} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[28px] font-light tracking-[-0.03em]">
                    {formatMoney(money(v.amountMinor, v.currency), locale)}
                  </span>
                  <span className="text-caption text-ink-2">{t('lifetimeOrders', { count: v.orders })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="scores-heading" className="flex flex-col gap-3">
        <h2 id="scores-heading" className="text-section">
          {t('scores')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-2">
              <CardLabel>{t('engagement')}</CardLabel>
              <p className="text-[28px] font-light tracking-[-0.03em]" data-testid="stat-engagement">
                {t('engagementValue', { score: s.engagementScore })}
              </p>
              <p className="text-caption text-ink-2">
                {t('engagementHow', {
                  wAttended: ENGAGEMENT_WEIGHTS.eventsAttended,
                  attended: s.eventsAttended,
                  wSessions: ENGAGEMENT_WEIGHTS.sessionsAttended,
                  sessions: s.sessionsAttended,
                  wCampaigns: ENGAGEMENT_WEIGHTS.campaignsOpened,
                  campaigns: s.campaignsOpened,
                  points,
                  half: ENGAGEMENT_HALF_POINTS,
                  score: s.engagementScore,
                })}
              </p>
            </div>
          </Card>
          <Card>
            <div className="flex flex-col gap-2">
              <CardLabel>{t('noShow')}</CardLabel>
              <p className="text-[28px] font-light tracking-[-0.03em]" data-testid="stat-no-show">
                {formatBps(s.noShowBps, locale)}
              </p>
              <p className="text-caption text-ink-2">
                {t('noShowHow', {
                  noShows: s.noShows,
                  priorNoShows: NO_SHOW_PRIOR.noShows,
                  past: s.pastRegistered,
                  priorRegistrations: NO_SHOW_PRIOR.registrations,
                  pct: formatBps(s.noShowBps, locale),
                })}
              </p>
            </div>
          </Card>
        </div>
        <Card>
          <div className="flex flex-col gap-2">
            <CardLabel>{t('rfm')}</CardLabel>
            {s.rfm ? (
              <dl className="flex flex-wrap gap-x-8 gap-y-2" data-testid="stat-rfm">
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-2">{t('recency')}</dt>
                  <dd className="text-body font-medium">{t('quintileValue', { q: s.rfm.recency })}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-2">{t('frequency')}</dt>
                  <dd className="text-body font-medium">{t('quintileValue', { q: s.rfm.frequency })}</dd>
                </div>
                {value?.monetaryQuintile ? (
                  <div className="flex flex-col">
                    <dt className="text-caption text-ink-2">{t('monetary')}</dt>
                    <dd className="text-body font-medium">
                      {t('quintileValue', { q: value.monetaryQuintile })}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-body text-ink-2">{t('rfmNone')}</p>
            )}
            <p className="text-caption text-ink-2">{t('rfmHow')}</p>
          </div>
        </Card>
        {s.computedAt ? (
          <p className="text-caption text-ink-2">{t('updated', { date: df.format(s.computedAt) })}</p>
        ) : null}
      </section>
    </>
  );
}

/**
 * The timeline header's stats line (M6.1b): engagement, no-show propensity and, for members who
 * can read finance, lifetime value, with a link to the contact page.
 */
export async function ContactStatsHeader({
  org,
  stats: s,
  value,
  locale,
}: {
  org: string;
  stats: ContactStatsDto;
  value: ContactValueDto | null;
  locale: string;
}) {
  const t = await getTranslations('contactStats');
  return (
    <div className="flex flex-col gap-1 text-caption" data-testid="timeline-stats">
      <p className="text-ink">
        {t('headerSummary', { score: s.engagementScore, pct: formatBps(s.noShowBps, locale) })}
        {value && value.lifetime.length > 0
          ? ` · ${t('headerValue', {
              amount: value.lifetime
                .map((v) => formatMoney(money(v.amountMinor, v.currency), locale))
                .join(' + '),
            })}`
          : ''}
      </p>
      <Link href={`/o/${org}/contacts/${s.contactId}`} className="self-start underline underline-offset-2">
        {t('viewContact')}
      </Link>
    </div>
  );
}
