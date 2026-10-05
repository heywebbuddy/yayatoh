import { executeQuery } from '@yayatoh/kernel';
import { promotedPlacementsEnabled, promotionsQuery } from '@yayatoh/marketplace';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, EmptyState, PageHeader, Select, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { endPromotionAction, promoteAction } from './actions.ts';

const DAYS = [7, 14, 30] as const;
const DONE = ['promoted', 'ended'] as const;
const ERRORS = ['days', 'not_listed', 'failed'] as const;

/**
 * Promoted placements (M6.14b): the org's public listings and their promotion in marketplace
 * search. A promoted listing shows above matching results, always labelled "Promoted". Behind a
 * flag; priced later (nothing is charged). Marketing writers promote; others read.
 */
export default async function PromotionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('promotions');
  const header = <PageHeader title={t('title')} description={t('description')} />;
  if (!promotedPlacementsEnabled())
    return (
      <>
        {header}
        <EmptyState
          title={t('offTitle')}
          description={t('offDescription')}
          action={
            <Link href={`/o/${org}/site`} className={buttonClass('primary', 'md')}>
              {t('toSite')}
            </Link>
          }
        />
      </>
    );
  const canWrite = roleCan(data.role, 'marketing:write');
  const listings = await executeQuery(promotionsQuery, {}, data.ctx, ports);
  const when = (d: Date, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
  const done = DONE.find((d) => d === sp.done);
  const error = ERRORS.find((e) => e === sp.error);
  return (
    <>
      {header}
      <Alert tone="info" title={t('free')} />
      {done ? (
        <div role="status">
          <Alert tone="success" title={t(`done.${done}`)} />
        </div>
      ) : null}
      {error ? (
        <div role="alert">
          <Alert tone="danger" title={t(`errors.${error}`)} />
        </div>
      ) : null}
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      {listings.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Link href={`/o/${org}/site`} className={buttonClass('primary', 'md')}>
              {t('toSite')}
            </Link>
          }
        />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(l) => l.eventId}
          rows={listings}
          columns={[
            { key: 'event', header: t('event'), cell: (l) => l.name },
            { key: 'when', header: t('starts'), cell: (l) => when(l.startsAt, l.timezone) },
            {
              key: 'state',
              header: t('state'),
              cell: (l) =>
                !l.onMarketplace ? (
                  <StatusDot status="neutral" label={t('notListed')} />
                ) : l.state === 'active' && l.promotedUntil ? (
                  <StatusDot
                    status="success"
                    label={t('activeUntil', { date: when(l.promotedUntil, l.timezone) })}
                  />
                ) : (
                  <StatusDot status="info" label={t(`states.${l.state}`)} />
                ),
            },
            ...(canWrite
              ? [
                  {
                    key: 'action',
                    header: t('actions'),
                    cell: (l: (typeof listings)[number]) =>
                      !l.onMarketplace ? (
                        <span className="text-caption text-ink-2">{t('listFirst')}</span>
                      ) : l.state === 'active' || l.state === 'scheduled' ? (
                        <form action={endPromotionAction.bind(null, org, l.eventId)}>
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            aria-label={t('endNamed', { name: l.name })}
                          >
                            {t('end')}
                          </Button>
                        </form>
                      ) : (
                        <form
                          action={promoteAction.bind(null, org, l.eventId)}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <Select
                            id={`days-${l.eventId}`}
                            name="days"
                            fieldSize="sm"
                            defaultValue="7"
                            aria-label={t('daysNamed', { name: l.name })}
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={String(d)}>
                                {t('days', { count: d })}
                              </option>
                            ))}
                          </Select>
                          <Button type="submit" size="sm" aria-label={t('promoteNamed', { name: l.name })}>
                            {t('promote')}
                          </Button>
                        </form>
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
