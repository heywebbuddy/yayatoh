import { DUPLICATE_STATUSES, duplicateQueueQuery } from '@yayatoh/crm';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, cx, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { PeopleActionForm } from '../people/action-form.tsx';
import { mergeSelectedAction, scanDuplicatesAction } from '../people/actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('duplicates.title') };
}

type Status = (typeof DUPLICATE_STATUSES)[number];
const UUID = /^[0-9a-f-]{36}$/;

/**
 * Audiences → Possible duplicates (M6.1a): the queue, highest confidence first, with the reason;
 * review one pair side by side, or merge several with the defaults (step-up).
 */
export default async function DuplicatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{
    status?: string;
    after?: string;
    scanned?: string;
    dismissed?: string;
    bulk?: string;
  }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'contacts:read')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('people');
  const status: Status = (DUPLICATE_STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as Status)
    : 'open';
  const [score, id] = (sp.after ?? '').split('_');
  const after =
    score && /^\d{1,3}$/.test(score) && id && UUID.test(id) ? { score: Number(score), id } : undefined;
  const queue = await executeQuery(
    duplicateQueueQuery,
    { status, limit: 25, ...(after ? { after } : {}) },
    data.ctx,
    ports,
  );
  const canMerge = roleCan(data.role, 'contacts:merge');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const who = (p: { name: string | null; email: string }) => p.name ?? p.email;
  const pairName = (r: (typeof queue.rows)[number]) => t('duplicates.pair', { a: who(r.a), b: who(r.b) });
  const reasons = (r: (typeof queue.rows)[number]) => r.reasons.map((x) => t(`reasons.${x}`)).join(', ');
  const selectable = canMerge && status === 'open';
  const nextHref = queue.next
    ? `/o/${org}/audiences/duplicates?${new URLSearchParams({ status, after: `${queue.next.score}_${queue.next.id}` })}`
    : null;
  const table = (
    <Table
      caption={t(`duplicates.caption.${status}`)}
      rowKey={(r) => r.id}
      rows={queue.rows}
      columns={[
        ...(selectable
          ? [
              {
                key: 'select',
                header: t('duplicates.select'),
                cell: (r: (typeof queue.rows)[number]) => (
                  <input
                    type="checkbox"
                    name="candidate"
                    value={r.id}
                    aria-label={t('duplicates.selectPair', { pair: pairName(r) })}
                    className="size-6 accent-ink"
                  />
                ),
              },
            ]
          : []),
        {
          key: 'people',
          header: t('duplicates.columns.people'),
          cell: (r) => (
            <div className="flex flex-col gap-1">
              {[r.a, r.b].map((p) => (
                <span key={p.id} className="flex flex-col">
                  <span className="text-body">{who(p)}</span>
                  <span className="text-caption break-all text-ink-2">{p.email}</span>
                </span>
              ))}
            </div>
          ),
        },
        {
          key: 'score',
          header: t('duplicates.columns.confidence'),
          align: 'end',
          cell: (r) => <span className="font-mono">{t('duplicates.score', { score: r.score })}</span>,
        },
        { key: 'reasons', header: t('duplicates.columns.reasons'), cell: (r) => reasons(r) },
        {
          key: 'review',
          header: t('duplicates.columns.review'),
          cell: (r) => (
            <Link
              href={`/o/${org}/audiences/duplicates/${r.id}`}
              className={buttonClass('secondary', 'sm')}
              aria-label={t('duplicates.reviewPair', { pair: pairName(r) })}
            >
              {t('duplicates.review')}
            </Link>
          ),
        },
      ]}
    />
  );
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences/people`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={t('duplicates.title')}
        description={t('duplicates.description')}
        actions={
          canMerge ? (
            <PeopleActionForm action={scanDuplicatesAction.bind(null, org)} messages={{}}>
              <Button type="submit">{t('duplicates.scan')}</Button>
            </PeopleActionForm>
          ) : undefined
        }
      />
      <p className="text-caption text-ink-2" data-testid="last-scan">
        {queue.lastScanAt
          ? t('duplicates.lastScan', { when: when.format(queue.lastScanAt) })
          : t('duplicates.neverScanned')}
      </p>
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.scanned !== undefined && /^\d+$/.test(sp.scanned) ? (
          <Alert tone="info" title={t('duplicates.scanned', { count: Number(sp.scanned) })} />
        ) : null}
        {sp.dismissed ? <Alert tone="info" title={t('duplicates.dismissedDone')} /> : null}
        {sp.bulk !== undefined && /^\d+$/.test(sp.bulk) ? (
          <Alert tone="info" title={t('duplicates.bulkDone', { count: Number(sp.bulk) })} />
        ) : null}
      </div>
      <nav aria-label={t('duplicates.statusNav')} className="flex flex-wrap gap-2">
        {DUPLICATE_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/o/${org}/audiences/duplicates${s === 'open' ? '' : `?status=${s}`}`}
            aria-current={s === status ? 'page' : undefined}
            className={cx(buttonClass(s === status ? 'primary' : 'ghost', 'sm'))}
          >
            {s === 'open'
              ? t('duplicates.status.open', { count: formatNumber(queue.open, locale) })
              : t(`duplicates.status.${s}`)}
          </Link>
        ))}
      </nav>
      {queue.rows.length === 0 ? (
        <EmptyState
          title={t(`duplicates.empty.${status}.title`)}
          description={t(`duplicates.empty.${status}.description`)}
        />
      ) : selectable ? (
        <PeopleActionForm
          action={mergeSelectedAction.bind(null, org)}
          messages={{
            none_selected: t('duplicates.errors.noneSelected'),
            too_many_selected: t('duplicates.errors.tooMany'),
            forbidden: t('errors.forbidden'),
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          {table}
          <div className="flex flex-col gap-1">
            <Button type="submit" variant="secondary" className="self-start">
              {t('duplicates.mergeSelected')}
            </Button>
            <p className="text-caption text-ink-2">{t('duplicates.mergeSelectedHint')}</p>
          </div>
        </PeopleActionForm>
      ) : (
        table
      )}
      {nextHref ? (
        <Link href={nextHref} className={`${buttonClass('secondary', 'sm')} self-start`}>
          {t('next')}
        </Link>
      ) : null}
    </>
  );
}
