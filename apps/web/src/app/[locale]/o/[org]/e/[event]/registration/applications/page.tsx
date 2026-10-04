import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import {
  approvalSetupQuery,
  QUEUE_STATUS_FILTERS,
  type RegistrantDetailDto,
  registrantDetailQuery,
  registrationDecideBulk,
  registrationQueueQuery,
  registrationSetupQuery,
} from '@yayatoh/registration';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Pagination,
  ProgressBar,
  Radio,
  SectionHeader,
  Select,
  StatusPill,
  Table,
  Tabs,
  tabClass,
} from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  bulkDecideAction,
  decideAction,
  removeTemplateAction,
  saveTemplateAction,
  substituteAction,
} from './actions.ts';

const UUID = /^[0-9a-f-]{36}$/;

/** A registrant's status as a StatusPill tone (dot + word). */
const STATUS_TONE = {
  pending: 'waiting',
  approved: 'info',
  confirmed: 'success',
  reserved: 'brand',
  denied: 'danger',
  cancelled: 'neutral',
} as const;

const label = 'text-[13px] font-bold text-ink';
const panel = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-6 elevation-card glass';

type SearchParams = {
  status?: string;
  type?: string;
  q?: string;
  page?: string;
  r?: string;
  op?: string;
  bulkError?: string;
};

/**
 * Applications and registrants (M5.1c): a queue filtered by status, type and name/email (pending
 * first), a detail drawer with the application answers and the decision trail, approve/deny with a
 * reason or a template, bulk decisions as one resumable operation with progress, reason templates,
 * and substitution for confirmed registrants. Viewers read; every control needs `events:write`.
 */
export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'registration')) notFound();
  const t = await getTranslations('registration.queue');
  const tv = await getTranslations('vocab');
  const tc = await getTranslations('common');
  const format = await getFormatter();
  const canWrite = roleCan(data.role, 'events:write');
  const status = (QUEUE_STATUS_FILTERS as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as (typeof QUEUE_STATUS_FILTERS)[number])
    : 'pending';
  const typeId = sp.type && UUID.test(sp.type) ? sp.type : null;
  const search = (sp.q ?? '').slice(0, 120);
  const page = Math.max(0, Math.min(10_000, Number(sp.page ?? 0) || 0));
  const [queue, setup, approval] = await Promise.all([
    executeQuery(
      registrationQueueQuery,
      { eventId: ev.id, status, registrationTypeId: typeId, search, page },
      data.ctx,
      ports,
    ),
    executeQuery(registrationSetupQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(approvalSetupQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  let detail: RegistrantDetailDto | null = null;
  if (sp.r && UUID.test(sp.r))
    detail = await executeQuery(
      registrantDetailQuery,
      { eventId: ev.id, registrantId: sp.r },
      data.ctx,
      ports,
    ).catch(() => null);
  const op =
    sp.op && UUID.test(sp.op)
      ? await executeQuery(registrationDecideBulk.status, { operationId: sp.op }, data.ctx, ports).catch(
          () => null,
        )
      : null;
  const base = `/o/${org}/e/${event}/registration/applications`;
  const query = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const all = { status, type: typeId, q: search || null, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const errors: Record<string, string> = {
    reason: t('errors.reason'),
    templateId: t('errors.templateId'),
    type_full: t('errors.type_full'),
    payment_started: t('errors.payment_started'),
    not_pending: t('errors.not_pending'),
    name: t('errors.name'),
    email: t('errors.email'),
    label: t('errors.label'),
    body: t('errors.body'),
    substitution_closed: t('errors.substitution_closed'),
    domain_not_allowed: t('errors.domain_not_allowed'),
    already_registered: t('errors.already_registered'),
    same_person: t('errors.same_person'),
    not_confirmed: t('errors.not_confirmed'),
    too_many: t('errors.too_many'),
  };
  const allTemplates = [
    { value: '', label: t('noTemplate') },
    ...approval.templates.map((x) => ({ value: x.id, label: `${t(`decision.${x.decision}`)} · ${x.label}` })),
  ];
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const failureCounts = new Map<string, number>();
  for (const f of op?.failures ?? []) failureCounts.set(f.code, (failureCounts.get(f.code) ?? 0) + 1);
  const failures = [...failureCounts];
  const pages = Math.ceil(queue.total / 50);
  const decidable = detail && !detail.hostName && ['pending', 'approved', 'denied'].includes(detail.status);
  type Row = (typeof queue.rows)[number];
  const fact = (term: string, value: ReactNode, className?: string) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] font-bold text-ink-2">{term}</dt>
      <dd className={`m-0 text-body text-ink ${className ?? ''}`}>{value}</dd>
    </div>
  );
  const people = (list: readonly { id: string; name: string; status: Row['status'] }[]) => (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {list.map((g) => (
        <li key={g.id} className="flex flex-wrap items-center gap-2 text-body">
          <Link
            href={query({ r: g.id })}
            className="inline-flex min-h-6 items-center font-bold text-primary-ink underline-offset-2 hover:underline"
          >
            {g.name}
          </Link>
          <StatusPill tone={STATUS_TONE[g.status]} label={t(`status.${g.status}`)} />
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tv('registration'), href: `/o/${org}/e/${event}/registration` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('subtitle')}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      {op ? (
        <section aria-labelledby="bulk-status-heading" className={panel}>
          {opActive ? <AutoRefresh seconds={2} /> : null}
          <h2 id="bulk-status-heading" className="m-0 text-card text-ink">
            {t('bulkTitle')}
          </h2>
          <ProgressBar
            value={op.processed}
            max={Math.max(1, op.total)}
            label={t('bulkProgress', {
              processed: formatNumber(op.processed, locale),
              total: formatNumber(op.total, locale),
            })}
            tone={op.status === 'failed' ? 'danger' : op.status === 'done' ? 'success' : 'primary'}
          />
          <p className="m-0 text-body font-bold text-ink" role="status">
            {op.status === 'done'
              ? t('bulkDone', { succeeded: op.succeeded, failed: op.failed })
              : op.status === 'failed'
                ? t('bulkFailed')
                : t('bulkRunning', { processed: op.processed, total: op.total })}
          </p>
          {failures.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption font-semibold text-danger">
              {failures.map(([code, count]) => (
                <li key={code}>
                  {t('bulkFailure', {
                    count,
                    reason: t.has(`code.${code}`) ? t(`code.${code}`) : t('code.other'),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {sp.bulkError ? (
        <Alert
          title={t.has(`bulkError.${sp.bulkError}`) ? t(`bulkError.${sp.bulkError}`) : t('bulkError.other')}
        />
      ) : null}

      <Tabs label={t('statusNav')} className="self-start">
        {QUEUE_STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={query({ status: s, page: null })}
            aria-current={s === status ? 'page' : undefined}
            className={tabClass(s === status)}
          >
            {t('statusCount', {
              status: t(`status.${s}`),
              count:
                s === 'all' ? Object.values(queue.counts).reduce((n, c) => n + c, 0) : (queue.counts[s] ?? 0),
            })}
          </Link>
        ))}
      </Tabs>

      <form
        method="get"
        action={base}
        aria-label={t('filters')}
        // Remount on navigation: uncontrolled fields would keep the previous filters' values.
        key={`${typeId ?? ''}|${search}`}
        className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 glass"
      >
        <input type="hidden" name="status" value={status} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="queue-type" className={label}>
            {t('type')}
          </label>
          <Select id="queue-type" name="type" defaultValue={typeId ?? ''} className="field">
            <option value="">{t('allTypes')}</option>
            {setup.types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="queue-q" className={label}>
            {t('search')}
          </label>
          <input
            id="queue-q"
            name="q"
            type="search"
            defaultValue={search}
            maxLength={120}
            className="field w-full"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('applyFilters')}
        </Button>
      </form>

      {detail ? (
        <aside aria-labelledby="detail-heading" className={`${panel} gap-4!`}>
          <CardHeader
            id="detail-heading"
            title={t('detailTitle', { name: detail.name })}
            actions={
              <Link
                href={query({ r: null })}
                className="inline-flex min-h-8 items-center rounded-[10px] px-2 text-body font-bold text-primary-ink hover:bg-surface-3"
              >
                {t('closeDetail')}
              </Link>
            }
          />
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {fact(t('field.email'), detail.email, 'break-all')}
            {fact(
              t('field.registration'),
              <>
                {detail.typeName} · {detail.itemName}
                {detail.addOns.length ? ` + ${detail.addOns.join(', ')}` : ''}
              </>,
            )}
            {fact(
              t('field.status'),
              <span className="flex flex-wrap items-center gap-2">
                <StatusPill tone={STATUS_TONE[detail.status]} label={t(`status.${detail.status}`)} />
                {detail.decisionSource ? (
                  <span className="text-caption text-ink-2">{t(`source.${detail.decisionSource}`)}</span>
                ) : null}
              </span>,
            )}
            {fact(
              t('field.applied'),
              format.dateTime(detail.createdAt, { dateStyle: 'medium', timeStyle: 'short' }),
              'tabular-nums',
            )}
            {detail.company ? fact(t('field.company'), detail.company) : null}
            {detail.jobTitle ? fact(t('field.jobTitle'), detail.jobTitle) : null}
            {detail.hostName ? fact(t('field.host'), detail.hostName) : null}
            {detail.ticketShortCode ? fact(t('field.ticket'), detail.ticketShortCode, 'font-mono') : null}
            {detail.substitutions > 0
              ? fact(t('field.substitutions'), detail.substitutions, 'tabular-nums')
              : null}
          </dl>
          {detail.message ? (
            <section aria-labelledby="detail-message" className="flex flex-col gap-1.5">
              <h3 id="detail-message" className="m-0 text-[13px] font-bold text-ink-2">
                {t('field.message')}
              </h3>
              <blockquote className="m-0 whitespace-pre-line rounded-tile border-s-4 border-primary bg-surface-2 px-4 py-3 text-body text-ink">
                {detail.message}
              </blockquote>
            </section>
          ) : null}
          {detail.decisionReason ? (
            <section aria-labelledby="detail-reason" className="flex flex-col gap-1.5">
              <h3 id="detail-reason" className="m-0 text-[13px] font-bold text-ink-2">
                {t('field.reason')}
              </h3>
              <p className="m-0 whitespace-pre-line rounded-tile bg-surface-2 px-4 py-3 text-body text-ink">
                {detail.decisionReason}
              </p>
            </section>
          ) : null}
          {detail.group.length ? (
            <section aria-labelledby="detail-group" className="flex flex-col gap-1.5">
              <h3 id="detail-group" className="m-0 text-body font-bold text-ink">
                {t('groupTitle')}
              </h3>
              {people(detail.group)}
            </section>
          ) : null}
          {detail.guests.length ? (
            <section aria-labelledby="detail-guests" className="flex flex-col gap-1.5">
              <h3 id="detail-guests" className="m-0 text-body font-bold text-ink">
                {t('guestsTitle')}
              </h3>
              {people(detail.guests)}
            </section>
          ) : null}
          {canWrite && decidable ? (
            <section
              aria-labelledby="decide-heading"
              className="flex flex-col gap-3 border-t border-line pt-4"
            >
              <h3 id="decide-heading" className="m-0 text-body font-bold text-ink">
                {t('decideTitle')}
              </h3>
              <ProgramForm
                key={`decide-${detail.id}`}
                action={decideAction.bind(null, org, event, detail.id)}
                fields={[
                  {
                    kind: 'select',
                    name: 'decision',
                    label: t('decisionLabel'),
                    options: [
                      ...(detail.status !== 'approved'
                        ? [{ value: 'approve', label: t('decision.approve') }]
                        : []),
                      ...(detail.status !== 'denied' ? [{ value: 'deny', label: t('decision.deny') }] : []),
                    ],
                  },
                  {
                    kind: 'select',
                    name: 'templateId',
                    label: t('template'),
                    hint: t('templateHint'),
                    options: allTemplates,
                  },
                  { kind: 'textarea', name: 'reason', label: t('reason'), hint: t('reasonHint'), rows: 3 },
                ]}
                idPrefix="decide"
                submitLabel={t('saveDecision')}
                successLabel={t('decisionSaved')}
                errors={errors}
              />
            </section>
          ) : null}
          {canWrite && detail.status === 'confirmed' ? (
            <details className="border-t border-line pt-3">
              <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-body font-bold text-primary-ink hover:bg-surface-3">
                {t('substituteTitle')}
              </summary>
              <div className="flex flex-col gap-2 pt-3">
                <p className="m-0 text-caption text-ink-2">
                  {t('substituteHint', {
                    until: format.dateTime(detail.substitutionClosesAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: ev.timezone,
                    }),
                  })}
                </p>
                <ProgramForm
                  action={substituteAction.bind(null, org, event, detail.id)}
                  fields={[
                    { kind: 'text', name: 'name', label: t('newName'), required: true, maxLength: 120 },
                    { kind: 'text', name: 'email', label: t('newEmail'), required: true, maxLength: 254 },
                  ]}
                  idPrefix="substitute"
                  submitLabel={t('substitute')}
                  successLabel={t('substituted')}
                  errors={errors}
                />
              </div>
            </details>
          ) : null}
        </aside>
      ) : null}

      {queue.rows.length === 0 ? (
        <EmptyState
          title={t(`empty.${status === 'pending' ? 'pending' : 'other'}`)}
          description={t(`emptyHint.${status === 'pending' ? 'pending' : 'other'}`)}
          action={
            typeId || search ? (
              <Link
                href={query({ type: null, q: null, page: null })}
                className={buttonClass('primary', 'md')}
              >
                {t('clearFilters')}
              </Link>
            ) : status === 'pending' ? (
              <Link href={`/o/${org}/e/${event}/registration`} className={buttonClass('primary', 'md')}>
                {t('openSetup')}
              </Link>
            ) : (
              <Link href={query({ status: 'pending', page: null })} className={buttonClass('primary', 'md')}>
                {t('showWaiting')}
              </Link>
            )
          }
        />
      ) : (
        <form
          action={bulkDecideAction.bind(null, org, event)}
          className="flex flex-col gap-3"
          aria-label={t('bulkLabel')}
        >
          <input type="hidden" name="f_status" value={status} />
          <input type="hidden" name="f_type" value={typeId ?? ''} />
          <p className="m-0 text-caption text-ink-2" role="status">
            {t('showing', { count: queue.total })}
          </p>
          <Table<Row>
            caption={t('listLabel')}
            rows={queue.rows}
            rowKey={(r) => r.id}
            stackOnPhone
            select={
              canWrite
                ? { name: 'ids', header: tc('select'), label: (r) => t('select', { name: r.name }) }
                : undefined
            }
            columns={[
              {
                key: 'name',
                header: t('search'),
                cell: (r) => (
                  <span className="flex min-w-0 flex-col items-start gap-0.5 text-start">
                    <Link
                      href={query({ r: r.id, page: page ? String(page) : null })}
                      aria-current={detail?.id === r.id ? 'true' : undefined}
                      className="inline-flex min-h-6 items-center font-bold text-primary-ink underline-offset-2 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="break-all text-caption text-ink-2">{r.email}</span>
                  </span>
                ),
              },
              {
                key: 'registration',
                header: t('field.registration'),
                cell: (r) => (
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {r.typeName} · {r.itemName}
                    </span>
                    {r.hostName ? (
                      <span className="text-caption text-ink-2">{t('guestOf', { name: r.hostName })}</span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('field.status'),
                cell: (r) => <StatusPill tone={STATUS_TONE[r.status]} label={t(`status.${r.status}`)} />,
              },
            ]}
          />
          {pages > 1 ? (
            <Pagination
              label={t('pages')}
              link={Link}
              previous={{ href: page > 0 ? query({ page: String(page - 1) }) : null, label: t('previous') }}
              next={{ href: page + 1 < pages ? query({ page: String(page + 1) }) : null, label: t('next') }}
              status={t('pageOf', { page: page + 1, pages })}
            />
          ) : null}
          {canWrite && (status === 'pending' || status === 'approved' || status === 'denied') ? (
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader title={t('bulkHeading')} />
              <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
                <legend className={`${label} pb-1`}>{t('scope')}</legend>
                <Radio name="scope" value="selected" defaultChecked label={t('scopeSelected')} />
                {status !== 'denied' ? (
                  <Radio
                    name="scope"
                    value="all"
                    label={t('scopeAll', { count: queue.total, status: t(`status.${status}`) })}
                  />
                ) : null}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-decision" className={label}>
                    {t('decisionLabel')}
                  </label>
                  <Select id="bulk-decision" name="decision" className="field w-full">
                    <option value="approve">{t('decision.approve')}</option>
                    <option value="deny">{t('decision.deny')}</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-template" className={label}>
                    {t('template')}
                  </label>
                  <Select id="bulk-template" name="templateId" className="field w-full">
                    {allTemplates.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-reason" className={label}>
                  {t('reason')}
                </label>
                <textarea
                  id="bulk-reason"
                  name="reason"
                  rows={2}
                  maxLength={1000}
                  className="field w-full py-3 leading-relaxed"
                />
              </div>
              <Button type="submit" className="self-start">
                {t('bulkSubmit')}
              </Button>
            </Card>
          ) : null}
        </form>
      )}

      <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
        <SectionHeader id="templates-heading" title={t('templatesTitle')} description={t('templatesHint')} />
        {approval.templates.length === 0 ? (
          <EmptyState
            title={t('noTemplates')}
            description={t('noTemplatesHint')}
            action={
              canWrite ? (
                <Link href="#adding-template-heading" className={buttonClass('secondary', 'md')}>
                  {t('writeFirstTemplate')}
                </Link>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('secondary', 'md')}>
                  {t('backToEvent')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
            {approval.templates.map((x) => (
              <li key={x.id} className="flex">
                <Card className="flex w-full flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={x.decision === 'approve' ? 'success' : 'danger'}
                      label={t(`decision.${x.decision}`)}
                    />
                    <h3 className="m-0 text-body font-bold text-ink">{x.label}</h3>
                  </div>
                  <p className="m-0 whitespace-pre-line text-body text-ink-2">{x.body}</p>
                  {canWrite ? (
                    <ProgramForm
                      action={removeTemplateAction.bind(null, org, event, x.id)}
                      fields={[]}
                      idPrefix={`remove-template-${x.id}`}
                      submitLabel={t('removeTemplate', { label: x.label })}
                      successLabel={t('templateRemoved')}
                      errors={errors}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <Card size="panel" className="flex flex-col gap-3">
            <CardHeader as="h3" id="adding-template-heading" title={t('addTemplate')} />
            <ProgramForm
              action={saveTemplateAction.bind(null, org, event)}
              fields={[
                {
                  kind: 'select',
                  name: 'decision',
                  label: t('templateFor'),
                  options: [
                    { value: 'deny', label: t('decision.deny') },
                    { value: 'approve', label: t('decision.approve') },
                  ],
                },
                { kind: 'text', name: 'label', label: t('templateLabel'), required: true, maxLength: 80 },
                { kind: 'textarea', name: 'body', label: t('templateBody'), rows: 3 },
              ]}
              idPrefix="new-template"
              submitLabel={t('addTemplate')}
              successLabel={t('templateAdded')}
              errors={errors}
              reset
            />
          </Card>
        ) : null}
      </section>
    </>
  );
}
