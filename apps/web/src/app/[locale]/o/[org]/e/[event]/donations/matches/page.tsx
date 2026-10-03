import {
  catchUpGiftRefunds,
  catchUpGifts,
  employerExportBulk,
  MATCH_RATIOS,
  type MatchDto,
  matchesQuery,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, isDomainError, money, utcToZonedInput } from '@yayatoh/kernel';
import type { BulkOperationDto } from '@yayatoh/platform';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  cardClass,
  cx,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionHeader,
  StatusPill,
} from '@yayatoh/ui';
import { Building2, HandCoins } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { cancelMatchAction, closeMatchAction, createMatchAction, exportEmployersAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.matches');
  return { title: t('title') };
}

type Tone = 'success' | 'info' | 'neutral' | 'waiting';

/**
 * Matching gifts of an event (M4.8f, P4-17): challenge matches (a sponsor matches a campaign's
 * confirmed gifts in a window, at a ratio, up to a cap), each with what it has come to so far;
 * closing one records the sponsor's own pledge. Then the employer matching list export. Readers of
 * orders see it; `events:write` adds, closes and cancels matches; `attendees:export` exports.
 */
export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ op?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.matches');
  const tn = await getTranslations('nav');
  const tb = await getTranslations('bulk');
  const te = await getTranslations();
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: `/o/${org}/e/${event}/donations` },
        { label: t('title') },
      ]}
    />
  );
  if (!can('orders:read'))
    return (
      <>
        <PageHeader breadcrumb={crumbs} title={t('title')} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {te('emptyActions.eventHome')}
            </Link>
          }
        />
      </>
    );
  // Gift outcomes and refunds from the outbox (the worker relays them; dev and e2e have none).
  await catchUpGifts(data.org.id);
  await catchUpGiftRefunds(data.org.id);
  const view = await executeQuery(matchesQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = can('events:write');
  const canExport = can('attendees:export');
  const fmt = (minor: number, currency = ev.currency) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const campaignName = new Map(view.campaigns.map((c) => [c.id, c.name]));
  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(employerExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch(
      (err) => {
        if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
        throw err;
      },
    );
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const errors = {
    campaignId: t('errors.campaign'),
    campaign: t('errors.campaign'),
    sponsorName: t('errors.sponsorName'),
    sponsorEmail: t('errors.sponsorEmail'),
    publicName: t('errors.publicName'),
    ratioPercent: t('errors.ratio'),
    capMinor: t('errors.cap'),
    startsAt: t('errors.startsAt'),
    endsAt: t('errors.endsAt'),
    window: t('errors.window'),
    too_many: t('errors.tooMany'),
    not_started: t('errors.notStarted'),
    match_closed: t('errors.closed'),
    match_cancelled: t('errors.cancelled'),
  };
  const now = new Date();
  // A new match runs from now (to the minute) for four hours unless the host changes it.
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'campaignId',
      label: t('fields.campaign'),
      options: view.campaigns.map((c) => ({ value: c.id, label: c.name })),
      defaultValue: view.campaigns[0]?.id,
    },
    {
      kind: 'text',
      name: 'sponsorName',
      label: t('fields.sponsorName'),
      hint: t('fields.sponsorNameHint'),
      required: true,
      maxLength: 120,
    },
    {
      kind: 'text',
      name: 'sponsorEmail',
      label: t('fields.sponsorEmail'),
      hint: t('fields.sponsorEmailHint'),
    },
    {
      kind: 'text',
      name: 'publicName',
      label: t('fields.publicName'),
      hint: t('fields.publicNameHint'),
      maxLength: 120,
    },
    {
      kind: 'select',
      name: 'ratioPercent',
      label: t('fields.ratio'),
      options: MATCH_RATIOS.map((r) => ({ value: String(r), label: t(`ratios.r${r}`) })),
      defaultValue: '100',
    },
    {
      kind: 'text',
      name: 'capMinor',
      label: t('fields.cap', { currency: ev.currency }),
      hint: t('fields.capHint'),
      required: true,
    },
    {
      kind: 'datetime-local',
      name: 'startsAt',
      label: t('fields.startsAt'),
      hint: t('fields.timeHint', { zone: ev.timezone }),
      required: true,
      defaultValue: utcToZonedInput(start, ev.timezone),
    },
    {
      kind: 'datetime-local',
      name: 'endsAt',
      label: t('fields.endsAt'),
      hint: t('fields.timeHint', { zone: ev.timezone }),
      required: true,
      defaultValue: utcToZonedInput(new Date(start.getTime() + 4 * 3_600_000), ev.timezone),
    },
  ];
  const state = (m: MatchDto): { tone: Tone; label: string } =>
    m.status === 'closed'
      ? { tone: 'neutral', label: t('status.closed') }
      : m.status === 'cancelled'
        ? { tone: 'neutral', label: t('status.cancelled') }
        : m.phase === 'live'
          ? { tone: 'success', label: t('phase.live') }
          : m.phase === 'scheduled'
            ? { tone: 'info', label: t('phase.scheduled') }
            : { tone: 'waiting', label: t('phase.ended') };
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="matches-heading" className="flex flex-col gap-4">
        <SectionHeader id="matches-heading" title={t('listTitle')} />
        {view.campaigns.length === 0 ? (
          <EmptyState
            icon={<HandCoins strokeWidth={2} />}
            title={t('noCampaignsTitle')}
            description={t('noCampaignsDescription')}
            action={
              <Link href={`/o/${org}/e/${event}/donations`} className={buttonClass('primary', 'md')}>
                {t('backToDonations')}
              </Link>
            }
          />
        ) : view.matches.length === 0 ? (
          <EmptyState
            icon={<HandCoins strokeWidth={2} />}
            title={t('emptyTitle')}
            description={canWrite ? t('emptyDescription') : t('emptyViewer')}
            action={
              canWrite ? (
                <a href="#add-match-heading" className={buttonClass('primary', 'md')}>
                  {t('addTitle')}
                </a>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('secondary', 'md')}>
                  {te('emptyActions.eventHome')}
                </Link>
              )
            }
          />
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0" data-testid="matches">
            {view.matches.map((m) => {
              const s = state(m);
              const headline = t('headline', {
                ratio: `r${m.ratioPercent}`,
                percent: n.format(m.ratioPercent),
                cap: fmt(m.capMinor, m.currency),
              });
              return (
                <li key={m.id}>
                  <Card size="panel" className="flex flex-col gap-3">
                    <CardHeader
                      as="h3"
                      title={m.sponsorName}
                      actions={<StatusPill tone={s.tone} label={s.label} />}
                    />
                    <p className="m-0 text-body font-bold text-ink">{headline}</p>
                    <p className="m-0 text-caption text-ink-2">
                      {t('window', {
                        campaign: campaignName.get(m.campaignId) ?? '',
                        start: when.format(m.startsAt),
                        end: when.format(m.endsAt),
                      })}
                    </p>
                    <p className="m-0 text-caption text-ink-2">
                      {m.publicName ? t('sponsorShown', { name: m.publicName }) : t('sponsorHidden')}
                      {m.sponsorEmail ? ` · ${m.sponsorEmail}` : ''}
                    </p>
                    <div className="flex flex-col gap-2">
                      <p className="m-0 text-body font-bold text-ink tabular-nums">
                        {t('progress', {
                          matched: fmt(m.matchedMinor, m.currency),
                          cap: fmt(m.capMinor, m.currency),
                        })}
                      </p>
                      <ProgressBar
                        value={Math.min(m.matchedMinor, m.capMinor)}
                        max={m.capMinor}
                        label={t('progressLabel', { name: m.sponsorName })}
                        tone="success"
                      />
                      {m.status === 'active' ? (
                        <>
                          <p className="m-0 text-caption text-ink-2">
                            {t('basis', { count: m.giftCount, eligible: fmt(m.eligibleMinor, m.currency) })}
                          </p>
                          <p className="m-0 text-caption text-ink-2">
                            {m.remainingMinor > 0
                              ? t('remaining', { amount: fmt(m.remainingMinor, m.currency) })
                              : t('reached')}
                          </p>
                        </>
                      ) : null}
                      {m.status === 'closed' ? (
                        <p className="m-0 text-body text-ink" data-testid="match-pledge">
                          {!m.pledge
                            ? t('pledgeNone')
                            : m.pledge.status === 'cancelled'
                              ? t('pledgeCancelled')
                              : t('pledgeRecorded', { amount: fmt(m.pledge.amountMinor, m.currency) })}
                        </p>
                      ) : null}
                    </div>
                    {canWrite && m.status === 'active' ? (
                      <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
                        {m.phase === 'scheduled' ? null : (
                          <ProgramForm
                            action={closeMatchAction.bind(null, org, event, m.id)}
                            fields={[]}
                            idPrefix={`close-${m.id}`}
                            submitLabel={t('close', { name: m.sponsorName })}
                            successLabel={t('closed')}
                            errors={errors}
                          />
                        )}
                        <ProgramForm
                          action={cancelMatchAction.bind(null, org, event, m.id)}
                          fields={[]}
                          idPrefix={`cancel-${m.id}`}
                          submitLabel={t('cancel', { name: m.sponsorName })}
                          successLabel={t('cancelled')}
                          errors={errors}
                        />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
        {canWrite && view.campaigns.length > 0 ? (
          <section aria-labelledby="add-match-heading">
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader as="h3" id="add-match-heading" title={t('addTitle')} />
              <p className="m-0 text-body text-ink-2">{t('addBody')}</p>
              <ProgramForm
                action={createMatchAction.bind(null, org, event)}
                fields={fields}
                idPrefix="new-match"
                submitLabel={t('add')}
                successLabel={t('added')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="employers-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="employers-heading"
          title={t('employerTitle')}
          actions={
            canExport && view.employerGiftCount > 0 ? (
              <StepUpForm
                action={exportEmployersAction.bind(null, org, event)}
                className="flex flex-wrap gap-3"
              >
                <Button type="submit" variant="secondary" size="sm">
                  {t('employerExport')}
                </Button>
              </StepUpForm>
            ) : undefined
          }
        />
        {sp.exportError ? (
          <Alert title={t('exportError', { reason: te(errorMessageKey(sp.exportError)) })} />
        ) : null}
        {op ? (
          <section
            aria-labelledby="employer-export-heading"
            className={cx(cardClass(), 'flex flex-col gap-3')}
          >
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h3 id="employer-export-heading" className="m-0 text-card text-ink">
              {t('exportTitle')}
            </h3>
            <p className="m-0 text-body text-ink" role="status">
              {op.status === 'done'
                ? tb('exportDone', { succeeded: n.format(op.succeeded) })
                : tb(`status.${op.status}`, {
                    processed: n.format(op.processed),
                    total: n.format(op.total),
                    succeeded: n.format(op.succeeded),
                    failed: n.format(op.failed),
                    undone: n.format(op.undone),
                  })}
            </p>
            {op.status === 'done' && op.hasFile ? (
              <a
                href={`${locale === 'en' ? '' : `/${locale}`}/o/${org}/e/${event}/donations/matches/exports/${op.id}`}
                className={buttonClass('primary', 'sm', 'self-start')}
                download
              >
                {tb('download')}
              </a>
            ) : null}
          </section>
        ) : null}
        {view.employerGiftCount === 0 ? (
          <EmptyState
            icon={<Building2 strokeWidth={2} />}
            title={t('employerEmptyTitle')}
            description={t('employerEmptyDescription')}
            action={
              <Link href={`/o/${org}/e/${event}/donations`} className={buttonClass('secondary', 'md')}>
                {tn('donations')}
              </Link>
            }
          />
        ) : (
          <Card className="flex flex-col gap-2">
            <p className="m-0 text-body text-ink" data-testid="employer-count">
              {t('employerBody', { count: view.employerGiftCount })}
            </p>
            {canExport ? null : <p className="m-0 text-caption text-ink-2">{t('employerAsk')}</p>}
          </Card>
        )}
      </section>
    </>
  );
}
