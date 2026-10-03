import { executeQuery } from '@yayatoh/kernel';
import { DELIVERABLE_OWNERS, type DeliverableDto, sponsorDeliverablesQuery } from '@yayatoh/program';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { addDeliverableAction, deleteDeliverableAction, setDeliverableDoneAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };
type T = Awaited<ReturnType<typeof getTranslations>>;

/** A due date (`YYYY-MM-DD`, the event's zone) as the viewer's locale writes it. */
const formatDay = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );

/**
 * Sponsor deliverables (M5.4b): every sponsor's checklist with due dates (end of the day in the
 * event's time zone) and who is responsible, the overdue ones first. Organizers add, tick off,
 * reopen and delete; viewers read.
 */
export default async function SponsorDeliverablesPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'sponsors');
  const q = await executeQuery(sponsorDeliverablesQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('sponsorship');
  const tn = await getTranslations('nav');
  const tp = await getTranslations('program');
  const base = `/o/${org}/e/${event}`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: base },
              { label: tn('sponsors'), href: `${base}/sponsors` },
              { label: t('deliverablesTitle') },
            ]}
          />
        }
        title={t('deliverablesTitle')}
        description={t('deliverablesSubtitle', { timezone: q.timezone })}
        actions={
          <Link href={`${base}/sponsors/packages`} className={buttonClass('secondary')}>
            {t('packagesLink')}
          </Link>
        }
      />
      {canWrite ? null : <Alert tone="info" title={tp('viewerNotice')} />}

      <section aria-labelledby="overdue-heading" className="flex flex-col gap-3">
        <h2 id="overdue-heading" className="text-section">
          {t('overdueHeading', { count: q.overdue.length })}
        </h2>
        {q.overdue.length === 0 ? (
          <p className="m-0 text-body text-ink-2" role="status">
            {t('noOverdue')}
          </p>
        ) : (
          <ul aria-label={t('overdueList')} className="m-0 flex list-none flex-col gap-2 p-0">
            {q.overdue.map((d) => (
              <li key={d.id}>
                <Row
                  d={d}
                  org={org}
                  event={event}
                  canWrite={canWrite}
                  locale={locale}
                  t={t}
                  prefix="overdue"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="all-deliverables-heading" className="flex flex-col gap-3">
        <h2 id="all-deliverables-heading" className="text-section">
          {t('allDeliverables', { count: q.deliverables.length })}
        </h2>
        {q.deliverables.length === 0 ? (
          <EmptyState
            title={t('noDeliverablesTitle')}
            description={q.sponsors.length ? t('noDeliverablesDescription') : t('noSponsorsDescription')}
            action={
              q.sponsors.length ? (
                <a href="#add-deliverable-heading" className={buttonClass('primary', 'md')}>
                  {t('addDeliverable')}
                </a>
              ) : (
                <Link href={`${base}/sponsors`} className={buttonClass('primary', 'md')}>
                  {tn('sponsors')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {q.deliverables.map((d) => (
              <li key={d.id}>
                <Row d={d} org={org} event={event} canWrite={canWrite} locale={locale} t={t} prefix="all" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite && q.sponsors.length ? (
        <section aria-labelledby="add-deliverable-heading">
          <Card size="panel" className="flex flex-col gap-3">
            <h2 id="add-deliverable-heading" className="m-0 text-section">
              {t('addDeliverable')}
            </h2>
            <ProgramForm
              action={addDeliverableAction.bind(null, org, event)}
              idPrefix="new-deliverable"
              submitLabel={t('addDeliverable')}
              successLabel={t('deliverableAdded')}
              errors={{
                sponsorId: t('errors.sponsor'),
                title: t('errors.title'),
                owner: t('errors.owner'),
                ownerName: t('errors.ownerName'),
                dueDate: t('errors.dueDate'),
                too_many: t('errors.tooManyDeliverables'),
              }}
              fields={[
                {
                  kind: 'select',
                  name: 'sponsorId',
                  label: t('sponsor'),
                  options: q.sponsors.map((s) => ({ value: s.id, label: s.name })),
                },
                { kind: 'text', name: 'title', label: t('deliverableTitle'), required: true, maxLength: 120 },
                {
                  kind: 'select',
                  name: 'owner',
                  label: t('owner'),
                  options: DELIVERABLE_OWNERS.map((o) => ({ value: o, label: t(`owners.${o}`) })),
                },
                {
                  kind: 'text',
                  name: 'ownerName',
                  label: t('ownerName'),
                  hint: t('ownerNameHint'),
                  maxLength: 80,
                },
                {
                  kind: 'date',
                  name: 'dueDate',
                  label: t('dueDate'),
                  hint: t('dueDateHint', { timezone: q.timezone }),
                  required: true,
                },
              ]}
              reset
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}

function Row({
  d,
  org,
  event,
  canWrite,
  locale,
  t,
  prefix,
}: {
  d: DeliverableDto;
  org: string;
  event: string;
  canWrite: boolean;
  locale: string;
  t: T;
  prefix: string;
}) {
  const status =
    d.status === 'done'
      ? { tone: 'success' as const, label: t('statusDone') }
      : d.overdue
        ? { tone: 'danger' as const, label: t('statusOverdue') }
        : { tone: 'waiting' as const, label: t('statusOpen') };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-bold text-ink">{d.title}</span>
        <span className="text-caption text-ink-2">
          {d.sponsorName} · {t(`owners.${d.owner}`)}
          {d.ownerName ? ` (${d.ownerName})` : ''} · {t('due', { date: formatDay(d.dueDate, locale) })}
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <StatusPill tone={status.tone} label={status.label} />
        {canWrite ? (
          <>
            <form action={setDeliverableDoneAction.bind(null, org, event, d.id, d.status !== 'done')}>
              <Button type="submit" variant="secondary" size="sm">
                {d.status === 'done' ? t('reopen', { title: d.title }) : t('markDone', { title: d.title })}
              </Button>
            </form>
            {prefix === 'all' ? (
              <form action={deleteDeliverableAction.bind(null, org, event, d.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  {t('deleteDeliverable', { title: d.title })}
                </Button>
              </form>
            ) : null}
          </>
        ) : null}
      </span>
    </Card>
  );
}
