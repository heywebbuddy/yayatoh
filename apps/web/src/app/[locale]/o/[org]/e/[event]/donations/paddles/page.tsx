import { type PaddleDto, paddlesQuery } from '@yayatoh/donations';
import { executeQuery } from '@yayatoh/kernel';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  SectionHeader,
  Table,
} from '@yayatoh/ui';
import { Hash, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { assignPaddleAction, bulkAssignAction, releasePaddleAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.paddles');
  return { title: t('title') };
}

/**
 * Paddle numbers (M4.8c): give guests or parties their paddle for the paddle raise, in bulk (every
 * guest, or the guests of purchased tables, numbered table by table) or one at a time at the
 * check-in desk. `guests:read` sees the list; `guests:write` gives and takes back paddles.
 */
export default async function PaddlesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can, opens } = await loadEvent(org, event, 'donations');
  if (!can('guests:read')) notFound();
  const view = await executeQuery(paddlesQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.paddles');
  const tn = await getTranslations('nav');
  const canWrite = can('guests:write');
  const n = new Intl.NumberFormat(locale);
  const base = `/o/${org}/e/${event}/donations`;
  const errors = {
    holder: t('errors.holder'),
    number: t('errors.number'),
    number_taken: t('errors.numberTaken'),
    has_paddle: t('errors.hasPaddle'),
    startAt: t('errors.number'),
    too_many: t('errors.tooMany'),
    nobody_left: t('errors.nobodyLeft'),
    has_entries: t('errors.hasEntries'),
  };
  const bulkFields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'scope',
      label: t('scope'),
      options: [
        { value: 'all', label: t('scopeAll') },
        { value: 'tables', label: t('scopeTables', { count: view.tableCount }) },
      ],
      defaultValue: view.tableCount > 0 ? 'tables' : 'all',
    },
    {
      kind: 'select',
      name: 'per',
      label: t('per'),
      options: [
        { value: 'guest', label: t('perGuest') },
        { value: 'party', label: t('perParty') },
      ],
      defaultValue: 'guest',
    },
    {
      kind: 'number',
      name: 'startAt',
      label: t('startAt'),
      hint: view.nextNumber ? t('startAtHint', { number: view.nextNumber }) : undefined,
    },
  ];
  const holders = [
    ...view.guestsWithout.map((g) => ({
      value: `guest:${g.id}`,
      label: t('holderGuest', { name: g.name, party: g.partyName }),
    })),
    ...view.partiesWithout.map((p) => ({
      value: `party:${p.id}`,
      label: p.isTable ? t('holderTable', { name: p.name }) : t('holderParty', { name: p.name }),
    })),
  ];
  const oneFields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'holder',
      label: t('holder'),
      options: [{ value: '', label: t('holderChoose') }, ...holders],
    },
    {
      kind: 'number',
      name: 'number',
      label: t('number'),
      hint: view.nextNumber ? t('numberHint', { number: view.nextNumber }) : undefined,
    },
  ];
  const nobody = view.guestsWithout.length + view.partiesWithout.length + view.paddles.length === 0;
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: base },
        { label: t('title') },
      ]}
    />
  );
  return (
    <>
      <PageHeader
        breadcrumb={crumbs}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href={`${base}/paddle-raise`} className={buttonClass('secondary', 'md')}>
            {t('openConsole')}
          </Link>
        }
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      {nobody ? (
        <EmptyState
          icon={<Users strokeWidth={2} />}
          title={t('noGuestsTitle')}
          description={t('noGuestsDescription')}
          action={
            opens('guests') ? (
              <Link href={`/o/${org}/e/${event}/guests`} className={buttonClass('primary', 'md')}>
                {t('openGuests')}
              </Link>
            ) : opens('tablesSponsors') ? (
              <Link href={`/o/${org}/e/${event}/tables-sponsors`} className={buttonClass('primary', 'md')}>
                {t('openTables')}
              </Link>
            ) : undefined
          }
        />
      ) : canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="bulk-heading">
            <Card size="panel" className="flex h-full flex-col gap-4">
              <CardHeader as="h2" id="bulk-heading" title={t('bulkTitle')} />
              <p className="m-0 text-body text-ink-2">{t('bulkBody')}</p>
              <ProgramForm
                action={bulkAssignAction.bind(null, org, event)}
                fields={bulkFields}
                idPrefix="bulk"
                submitLabel={t('bulkSubmit')}
                successLabel={t('bulkDone')}
                errors={errors}
              />
            </Card>
          </section>
          <section aria-labelledby="one-heading">
            <Card size="panel" className="flex h-full flex-col gap-4">
              <CardHeader as="h2" id="one-heading" title={t('oneTitle')} />
              <p className="m-0 text-body text-ink-2">{t('oneBody')}</p>
              <ProgramForm
                action={assignPaddleAction.bind(null, org, event)}
                fields={oneFields}
                idPrefix="one"
                submitLabel={t('oneSubmit')}
                successLabel={t('oneDone')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        </div>
      ) : null}
      <section aria-labelledby="paddles-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="paddles-heading"
          title={t('listTitle')}
          description={t('listCount', { count: view.paddles.length })}
        />
        {view.paddles.length === 0 ? (
          nobody ? null : (
            <EmptyState
              icon={<Hash strokeWidth={2} />}
              title={t('emptyTitle')}
              description={canWrite ? t('emptyDescription') : t('emptyViewer')}
              action={
                canWrite ? (
                  <a href="#bulk-heading" className={buttonClass('primary', 'md')}>
                    {t('bulkTitle')}
                  </a>
                ) : (
                  <Link href={base} className={buttonClass('secondary', 'md')}>
                    {tn('donations')}
                  </Link>
                )
              }
            />
          )
        ) : (
          <Table<PaddleDto>
            caption={t('listTitle')}
            rows={view.paddles}
            rowKey={(p) => p.id}
            empty={t('emptyTitle')}
            columns={[
              {
                key: 'number',
                header: t('columns.number'),
                mono: true,
                cell: (p) => <span className="font-bold text-ink">{n.format(p.number)}</span>,
              },
              {
                key: 'holder',
                header: t('columns.holder'),
                cell: (p) =>
                  p.holderKind === 'party' ? t('partyPaddle', { name: p.holderName }) : p.holderName,
              },
              { key: 'party', header: t('columns.party'), cell: (p) => p.partyName ?? '—' },
              {
                key: 'entries',
                header: t('columns.entries'),
                align: 'end',
                mono: true,
                cell: (p) => n.format(p.entries),
              },
              ...(canWrite
                ? [
                    {
                      key: 'actions',
                      header: t('columns.actions'),
                      cell: (p: PaddleDto) =>
                        p.entries > 0 ? (
                          '—'
                        ) : (
                          <ProgramForm
                            action={releasePaddleAction.bind(null, org, event, p.id)}
                            fields={[]}
                            idPrefix={`release-${p.id}`}
                            submitLabel={t('release', { number: p.number })}
                            successLabel={t('released')}
                            errors={errors}
                          />
                        ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>
    </>
  );
}
