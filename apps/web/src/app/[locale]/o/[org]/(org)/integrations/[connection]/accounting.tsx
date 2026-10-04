import {
  ACCOUNT_CATEGORIES,
  accountingDetailQuery,
  addDays,
  chartOfAccounts,
  dayIn,
  type JournalDto,
  type JournalStatus,
} from '@yayatoh/integrations';
import { type Ctx, executeQuery, formatMoney, money } from '@yayatoh/kernel';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  EmptyState,
  SectionHeader,
  StatusPill,
  type StatusTone,
  Table,
} from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { saveAccountMapAction, syncNowAction } from '../actions.ts';
import { codeText } from '../parts.tsx';
import { AccountMapForm } from './account-map-form.tsx';

const JOURNAL_TONE: Record<JournalStatus, StatusTone> = {
  pending: 'waiting',
  posted: 'success',
  failed: 'danger',
  superseded: 'neutral',
};

/** How far back the mapping form starts by default: the last 30 days. */
const DEFAULT_BACKFILL_DAYS = 30;

/**
 * An accounting connection's console (M6.5d): the chart-of-accounts mapping (writers; read-only
 * for others) and the daily summary journals with their revisions, reversals and delivery state.
 */
export async function AccountingSection({
  org,
  connectionId,
  connectorName,
  ctx,
  locale,
  timeZone,
  canManage,
  live,
  status,
}: {
  org: string;
  connectionId: string;
  connectorName: string;
  ctx: Ctx;
  locale: string;
  timeZone: string;
  canManage: boolean;
  live: boolean;
  /** The connection's status (`Sync now` only while active). */
  status: string;
}) {
  const t = await getTranslations('integrations.accounting');
  const tIntegrations = await getTranslations('integrations');
  const detail = await executeQuery(accountingDetailQuery, { connectionId }, ctx, ports);
  const auth = integrationAuth();
  const editing = canManage && live;
  const chart = editing && auth ? await chartOfAccounts(ctx, ports, auth, connectionId) : null;
  const today = dayIn(ctx.now, timeZone);
  const dayFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const showDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));
  const amount = (j: JournalDto) => formatMoney(money(j.debitTotalMinor, j.currency), locale);
  const map = detail.map;
  return (
    <>
      <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
        <SectionHeader id="accounts-heading" title={t('mapTitle')} description={t('mapHelp')} />
        {!map ? <Alert tone="info" title={t('notMapped')} /> : null}
        {map ? (
          <p className="m-0 text-caption text-ink-2" data-testid="account-map-version">
            {t('version', { version: map.version, day: showDay(map.startsOn) })}
          </p>
        ) : null}
        {editing && chart ? (
          <div id="new-account-map">
            <AccountMapForm
              accounts={chart}
              current={map?.accounts ?? null}
              startsOn={map?.startsOn ?? addDays(today, -DEFAULT_BACKFILL_DAYS)}
              today={today}
              timeZone={timeZone}
              action={saveAccountMapAction.bind(null, org, connectionId)}
            />
          </div>
        ) : null}
        {editing && !chart ? (
          <Alert tone="warning" title={t('chartUnavailable', { name: connectorName })} />
        ) : null}
        {!editing && map ? (
          <Card>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              {ACCOUNT_CATEGORIES.map((c) => (
                <div key={c} className="contents">
                  <dt className="text-ink-2">{t(`categories.${c}.label`)}</dt>
                  <dd className="m-0">
                    {map.accounts[c].code ? `${map.accounts[c].code} · ` : ''}
                    {map.accounts[c].name}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}
      </section>
      <section aria-labelledby="journals-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="journals-heading"
          title={t('journalsTitle')}
          count={detail.journals.length}
          description={t('journalsHelp')}
        />
        {detail.waiting > 0 ? (
          <p className="m-0 text-body text-ink-2">{t('waiting', { count: detail.waiting })}</p>
        ) : null}
        {detail.journals.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={map ? t('emptyMapped') : t('emptyUnmapped')}
            action={
              editing && !map ? (
                <a href="#new-account-map" className={buttonClass('secondary')}>
                  {t('emptyMapAction')}
                </a>
              ) : editing && status === 'active' ? (
                <form action={syncNowAction.bind(null, org, connectionId)}>
                  <Button type="submit" variant="secondary">
                    {t('emptyPostAction')}
                  </Button>
                </form>
              ) : (
                <Link href={`/o/${org}/integrations`} className={buttonClass('secondary')}>
                  {t('emptyBackAction')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('journalsCaption')}
            rowKey={(j) => j.id}
            rows={detail.journals}
            stackOnPhone
            columns={[
              { key: 'day', header: t('columns.day'), cell: (j) => showDay(j.day) },
              { key: 'currency', header: t('columns.currency'), cell: (j) => j.currency },
              {
                key: 'kind',
                header: t('columns.kind'),
                cell: (j) => t(`kinds.${j.kind}`, { revision: j.revision }),
              },
              { key: 'amount', header: t('columns.amount'), cell: amount, align: 'end' },
              {
                key: 'status',
                header: t('columns.status'),
                cell: (j) => (
                  <span className="flex flex-col gap-1">
                    <StatusPill tone={JOURNAL_TONE[j.status]} label={t(`status.${j.status}`)} />
                    {j.status === 'failed' && j.lastErrorCode ? (
                      <span className="text-caption text-ink-2">
                        {codeText(tIntegrations, j.lastErrorCode)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { key: 'reference', header: t('columns.reference'), cell: (j) => j.externalId ?? '—' },
            ]}
          />
        )}
      </section>
    </>
  );
}
