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
import { Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
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
  const chip = (current: boolean) =>
    `inline-flex min-h-8 items-center rounded-pill border px-3 text-caption ${current ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700'}`;
  const decidable = detail && !detail.hostName && ['pending', 'approved', 'denied'].includes(detail.status);
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Link
        href={`/o/${org}/e/${event}/registration`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('backToSetup')}
      </Link>
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}

      {op ? (
        <section
          aria-labelledby="bulk-status-heading"
          className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
        >
          {opActive ? <AutoRefresh seconds={2} /> : null}
          <h2 id="bulk-status-heading" className="text-section">
            {t('bulkTitle')}
          </h2>
          <progress
            value={op.processed}
            max={Math.max(1, op.total)}
            aria-label={t('bulkProgress', {
              processed: formatNumber(op.processed, locale),
              total: formatNumber(op.total, locale),
            })}
            className="h-2 w-full accent-ink"
          />
          <p className="text-body" role="status">
            {op.status === 'done'
              ? t('bulkDone', { succeeded: op.succeeded, failed: op.failed })
              : op.status === 'failed'
                ? t('bulkFailed')
                : t('bulkRunning', { processed: op.processed, total: op.total })}
          </p>
          {failures.length ? (
            <ul className="flex list-none flex-col gap-1 p-0 text-caption text-pink-700">
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
        <p role="alert" className="text-body text-pink-700">
          {t.has(`bulkError.${sp.bulkError}`) ? t(`bulkError.${sp.bulkError}`) : t('bulkError.other')}
        </p>
      ) : null}

      <nav aria-label={t('statusNav')} className="flex flex-wrap gap-2">
        {QUEUE_STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={query({ status: s, page: null })}
            aria-current={s === status ? 'page' : undefined}
            className={chip(s === status)}
          >
            {t('statusCount', {
              status: t(`status.${s}`),
              count:
                s === 'all' ? Object.values(queue.counts).reduce((n, c) => n + c, 0) : (queue.counts[s] ?? 0),
            })}
          </Link>
        ))}
      </nav>

      <form
        method="get"
        action={base}
        aria-label={t('filters')}
        className="flex flex-col gap-3 md:flex-row md:items-end"
      >
        <input type="hidden" name="status" value={status} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="queue-type" className="text-caption text-zinc-600">
            {t('type')}
          </label>
          <select
            id="queue-type"
            name="type"
            defaultValue={typeId ?? ''}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          >
            <option value="">{t('allTypes')}</option>
            {setup.types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="queue-q" className="text-caption text-zinc-600">
            {t('search')}
          </label>
          <input
            id="queue-q"
            name="q"
            type="search"
            defaultValue={search}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          />
        </div>
        <Button type="submit" variant="secondary" className="self-start md:self-end">
          {t('applyFilters')}
        </Button>
      </form>

      {detail ? (
        <aside
          aria-labelledby="detail-heading"
          className="flex flex-col gap-3 rounded-panel border border-zinc-200 bg-white px-5 py-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="detail-heading" className="text-section">
              {t('detailTitle', { name: detail.name })}
            </h2>
            <Link href={query({ r: null })} className="min-h-6 text-body underline underline-offset-2">
              {t('closeDetail')}
            </Link>
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-[max-content_1fr]">
            <dt className="text-zinc-600">{t('field.email')}</dt>
            <dd>{detail.email}</dd>
            <dt className="text-zinc-600">{t('field.registration')}</dt>
            <dd>
              {detail.typeName} · {detail.itemName}
              {detail.addOns.length ? ` + ${detail.addOns.join(', ')}` : ''}
            </dd>
            <dt className="text-zinc-600">{t('field.status')}</dt>
            <dd>
              {t(`status.${detail.status}`)}
              {detail.decisionSource ? ` · ${t(`source.${detail.decisionSource}`)}` : ''}
            </dd>
            <dt className="text-zinc-600">{t('field.applied')}</dt>
            <dd>{format.dateTime(detail.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            {detail.company ? (
              <>
                <dt className="text-zinc-600">{t('field.company')}</dt>
                <dd>{detail.company}</dd>
              </>
            ) : null}
            {detail.jobTitle ? (
              <>
                <dt className="text-zinc-600">{t('field.jobTitle')}</dt>
                <dd>{detail.jobTitle}</dd>
              </>
            ) : null}
            {detail.message ? (
              <>
                <dt className="text-zinc-600">{t('field.message')}</dt>
                <dd className="whitespace-pre-line">{detail.message}</dd>
              </>
            ) : null}
            {detail.decisionReason ? (
              <>
                <dt className="text-zinc-600">{t('field.reason')}</dt>
                <dd className="whitespace-pre-line">{detail.decisionReason}</dd>
              </>
            ) : null}
            {detail.hostName ? (
              <>
                <dt className="text-zinc-600">{t('field.host')}</dt>
                <dd>{detail.hostName}</dd>
              </>
            ) : null}
            {detail.ticketShortCode ? (
              <>
                <dt className="text-zinc-600">{t('field.ticket')}</dt>
                <dd className="font-mono">{detail.ticketShortCode}</dd>
              </>
            ) : null}
            {detail.substitutions > 0 ? (
              <>
                <dt className="text-zinc-600">{t('field.substitutions')}</dt>
                <dd>{detail.substitutions}</dd>
              </>
            ) : null}
          </dl>
          {detail.group.length ? (
            <section aria-labelledby="detail-group" className="flex flex-col gap-1">
              <h3 id="detail-group" className="text-body font-medium">
                {t('groupTitle')}
              </h3>
              <ul className="flex flex-col gap-1 ps-5">
                {detail.group.map((g) => (
                  <li key={g.id} className="list-disc text-body">
                    <Link href={query({ r: g.id })} className="underline underline-offset-2">
                      {g.name}
                    </Link>{' '}
                    · {t(`status.${g.status}`)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {detail.guests.length ? (
            <section aria-labelledby="detail-guests" className="flex flex-col gap-1">
              <h3 id="detail-guests" className="text-body font-medium">
                {t('guestsTitle')}
              </h3>
              <ul className="flex flex-col gap-1 ps-5">
                {detail.guests.map((g) => (
                  <li key={g.id} className="list-disc text-body">
                    <Link href={query({ r: g.id })} className="underline underline-offset-2">
                      {g.name}
                    </Link>{' '}
                    · {t(`status.${g.status}`)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {canWrite && decidable ? (
            <section aria-labelledby="decide-heading" className="flex flex-col gap-2">
              <h3 id="decide-heading" className="text-body font-medium">
                {t('decideTitle')}
              </h3>
              <ProgramForm
                key={`decide-${detail.id}-${detail.status}`}
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
            <details>
              <summary className="min-h-6 cursor-pointer text-body underline underline-offset-2">
                {t('substituteTitle')}
              </summary>
              <div className="flex flex-col gap-2 pt-3">
                <p className="text-caption text-zinc-600">
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
        <Card>
          <EmptyState
            title={t(`empty.${status === 'pending' ? 'pending' : 'other'}`)}
            description={t(`emptyHint.${status === 'pending' ? 'pending' : 'other'}`)}
          />
        </Card>
      ) : (
        <form
          action={bulkDecideAction.bind(null, org, event)}
          className="flex flex-col gap-3"
          aria-label={t('bulkLabel')}
        >
          <input type="hidden" name="f_status" value={status} />
          <input type="hidden" name="f_type" value={typeId ?? ''} />
          <p className="text-caption text-zinc-600" role="status">
            {t('showing', { count: queue.total })}
          </p>
          <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('listLabel')}>
            {queue.rows.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-row items-start gap-3">
                  {canWrite ? (
                    <input
                      type="checkbox"
                      name="ids"
                      value={r.id}
                      aria-label={t('select', { name: r.name })}
                      className="mt-1 size-6 shrink-0"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={query({ r: r.id, page: page ? String(page) : null })}
                      className="min-h-6 text-body font-medium underline underline-offset-2"
                    >
                      {r.name}
                    </Link>
                    <span className="break-all text-caption text-zinc-600">{r.email}</span>
                    <span className="text-caption text-zinc-600">
                      {r.typeName} · {r.itemName} · {t(`status.${r.status}`)}
                      {r.hostName ? ` · ${t('guestOf', { name: r.hostName })}` : ''}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t('pages')} className="flex flex-wrap gap-2">
              {page > 0 ? (
                <Link href={query({ page: String(page - 1) })} className="underline underline-offset-2">
                  {t('previous')}
                </Link>
              ) : null}
              <span className="text-caption text-zinc-600">{t('pageOf', { page: page + 1, pages })}</span>
              {page + 1 < pages ? (
                <Link href={query({ page: String(page + 1) })} className="underline underline-offset-2">
                  {t('next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
          {canWrite && (status === 'pending' || status === 'approved' || status === 'denied') ? (
            <Card size="panel" className="flex flex-col gap-3">
              <h2 className="text-section">{t('bulkHeading')}</h2>
              <fieldset className="flex flex-col gap-1">
                <legend className="pb-1 text-caption text-zinc-600">{t('scope')}</legend>
                <label className="flex min-h-6 items-center gap-2 text-body">
                  <input type="radio" name="scope" value="selected" defaultChecked className="size-5" />
                  {t('scopeSelected')}
                </label>
                {status !== 'denied' ? (
                  <label className="flex min-h-6 items-center gap-2 text-body">
                    <input type="radio" name="scope" value="all" className="size-5" />
                    {t('scopeAll', { count: queue.total, status: t(`status.${status}`) })}
                  </label>
                ) : null}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-decision" className="text-caption text-zinc-600">
                  {t('decisionLabel')}
                </label>
                <select
                  id="bulk-decision"
                  name="decision"
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  <option value="approve">{t('decision.approve')}</option>
                  <option value="deny">{t('decision.deny')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-template" className="text-caption text-zinc-600">
                  {t('template')}
                </label>
                <select
                  id="bulk-template"
                  name="templateId"
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  {allTemplates.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bulk-reason" className="text-caption text-zinc-600">
                  {t('reason')}
                </label>
                <textarea
                  id="bulk-reason"
                  name="reason"
                  rows={2}
                  maxLength={1000}
                  className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
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
        <h2 id="templates-heading" className="text-section">
          {t('templatesTitle')}
        </h2>
        <p className="text-body text-zinc-600">{t('templatesHint')}</p>
        {approval.templates.length === 0 ? (
          <p className="text-body text-zinc-500">{t('noTemplates')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {approval.templates.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">
                    {t(`decision.${x.decision}`)} · {x.label}
                  </h3>
                  <p className="whitespace-pre-line text-caption text-zinc-600">{x.body}</p>
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
            <h3 className="text-section">{t('addTemplate')}</h3>
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
