import { randomUUID } from 'node:crypto';
import { type BatchDto, badgeTicketsQuery } from '@yayatoh/badges';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, Button, buttonClass, Card, Chip, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadBadgesPage, loadBatches } from '@/server/badges.ts';
import { ports } from '@/server/ports.ts';
import {
  assignAction,
  cancelBatchAction,
  createTemplateAction,
  deleteTemplateAction,
  overrideBadgeAction,
  setDefaultAction,
  startBatchAction,
} from './actions.ts';

const SIZES = ['fold_4x3', 'label_4x6', 'cr80', 'brother_62', 'brother_4in'] as const;
const BATCH_ERRORS = new Set(['nothing_to_print', 'no_template', 'too_many', 'not_running']);

/**
 * Badges (M5.5a): templates (designer per template), one template per ticket type (else the
 * default), batch PDFs sorted by last name or company, and one-badge PDFs for the desk. Printing
 * is the PDF itself (Stage 1, P5-2): AirPrint or the browser's print dialog.
 */
export default async function BadgesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ batchError?: string; q?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, ev, setup, canWrite, canExport, canPrintOne } = await loadBadgesPage(org, event);
  const batches = await loadBatches(data.ctx, ev.id);
  const q = (sp.q ?? '').slice(0, 80);
  const found =
    canPrintOne && q ? await executeQuery(badgeTicketsQuery, { eventId: ev.id, q }, data.ctx, ports) : [];
  const t = await getTranslations();
  const tb = await getTranslations('badges');
  const format = await getFormatter();
  const base = `/o/${org}/e/${event}/badges`;
  // Route handlers (PDFs) are linked directly: the default locale has no prefix.
  const raw = `${locale === 'en' ? '' : `/${locale}`}${base}`;
  const errors = {
    name: tb('errors.name'),
    'conflict.name': tb('errors.nameTaken'),
    too_many: tb('errors.tooManyTemplates'),
  };
  const templateName = new Map(setup.templates.map((x) => [x.id, x.name]));
  const fallback = setup.templates.find((x) => x.isDefault);
  const typeName = new Map(setup.ticketTypes.map((x) => [x.id, x.name]));
  const busy = batches.some((b) => b.status === 'queued' || b.status === 'running');
  const batchError =
    sp.batchError && BATCH_ERRORS.has(sp.batchError) ? sp.batchError : sp.batchError ? 'other' : null;

  const batchLine = (b: BatchDto) => {
    const types = b.ticketTypeIds.map((id) => typeName.get(id) ?? '—').join(', ');
    return [
      tb(`sorts.${b.sort}`),
      types ? tb('onlyTypes', { types }) : tb('allTypes'),
      format.dateTime(b.createdAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: data.org.timezone }),
    ].join(' · ');
  };

  return (
    <>
      <PageHeader title={t('nav.badges')} description={tb('subtitle')} />
      {canWrite ? null : <p className="text-body text-zinc-500">{tb('viewerNotice')}</p>}

      <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
        <h2 id="templates-heading" className="text-section">
          {tb('templates')}
        </h2>
        {setup.templates.length === 0 ? (
          <EmptyState title={tb('emptyTitle')} description={tb('emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {setup.templates.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-body font-medium">{x.name}</h3>
                    {x.isDefault ? <Chip>{tb('default')}</Chip> : null}
                  </div>
                  <p className="text-caption text-zinc-600">
                    {tb(`sizes.${x.size}`)} · {tb('version', { version: x.version })}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/${x.id}`} className={buttonClass('secondary', 'sm')}>
                      {canWrite ? tb('openDesigner', { name: x.name }) : tb('openPreview', { name: x.name })}
                    </Link>
                    <a href={`${raw}/preview/${x.id}?lang=en`} className={buttonClass('ghost', 'sm')}>
                      {tb('previewPdfEnglish', { name: x.name })}
                    </a>
                    <a href={`${raw}/preview/${x.id}?lang=ar`} className={buttonClass('ghost', 'sm')}>
                      {tb('previewPdfArabic', { name: x.name })}
                    </a>
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap gap-4">
                      {x.isDefault ? null : (
                        <ProgramForm
                          action={setDefaultAction.bind(null, org, event, x.id)}
                          fields={[]}
                          idPrefix={`default-${x.id}`}
                          submitLabel={tb('makeDefault', { name: x.name })}
                          successLabel={tb('defaultSet')}
                          errors={errors}
                        />
                      )}
                      <ProgramForm
                        action={deleteTemplateAction.bind(null, org, event, x.id)}
                        fields={[]}
                        idPrefix={`delete-${x.id}`}
                        submitLabel={tb('delete', { name: x.name })}
                        successLabel={tb('deleted')}
                        errors={errors}
                      />
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="new-template-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="new-template-heading" className="text-section">
                {tb('newTemplate')}
              </h3>
              <ProgramForm
                action={createTemplateAction.bind(null, org, event)}
                fields={[
                  { kind: 'text', name: 'name', label: tb('templateName'), required: true, maxLength: 80 },
                  {
                    kind: 'select',
                    name: 'size',
                    label: tb('size'),
                    hint: tb('sizeChoiceHint'),
                    options: SIZES.map((k) => ({ value: k, label: tb(`sizes.${k}`) })),
                    defaultValue: 'fold_4x3',
                  },
                  ...(setup.templates.length
                    ? [
                        {
                          kind: 'select' as const,
                          name: 'copyFromId',
                          label: tb('copyFrom'),
                          options: [
                            { value: '', label: tb('startBlank') },
                            ...setup.templates.map((x) => ({ value: x.id, label: x.name })),
                          ],
                        },
                      ]
                    : []),
                ]}
                idPrefix="new-template"
                submitLabel={tb('create')}
                successLabel={tb('created')}
                errors={errors}
              />
            </Card>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="assign-heading" className="flex flex-col gap-3">
        <h2 id="assign-heading" className="text-section">
          {tb('byTicketType')}
        </h2>
        <p className="max-w-prose text-caption text-zinc-500">{tb('byTicketTypeHint')}</p>
        {setup.ticketTypes.length === 0 ? (
          <p className="text-body text-zinc-500">{tb('noTicketTypes')}</p>
        ) : setup.templates.length === 0 ? null : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {setup.ticketTypes.map((tt) => {
              const assigned = setup.assignments.find((a) => a.ticketTypeId === tt.id)?.templateId ?? '';
              return (
                <li key={tt.id}>
                  <Card className="flex flex-col gap-2">
                    {canWrite ? (
                      <ProgramForm
                        action={assignAction.bind(null, org, event, tt.id)}
                        fields={[
                          {
                            kind: 'select',
                            name: 'templateId',
                            label: tb('templateFor', { type: tt.name }),
                            defaultValue: assigned,
                            options: [
                              { value: '', label: tb('useDefault', { name: fallback?.name ?? '—' }) },
                              ...setup.templates.map((x) => ({ value: x.id, label: x.name })),
                            ],
                          },
                        ]}
                        idPrefix={`assign-${tt.id}`}
                        submitLabel={tb('saveFor', { type: tt.name })}
                        successLabel={tb('assigned')}
                        errors={errors}
                      />
                    ) : (
                      <p className="text-body">
                        {tt.name}:{' '}
                        {assigned
                          ? templateName.get(assigned)
                          : tb('useDefault', { name: fallback?.name ?? '—' })}
                      </p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="batch-heading" className="flex flex-col gap-3">
        <h2 id="batch-heading" className="text-section">
          {tb('batch')}
        </h2>
        <p className="max-w-prose text-caption text-zinc-500">{tb('printHint')}</p>
        {batchError ? <Alert title={tb(`batchErrors.${batchError}`)} /> : null}
        {canExport && setup.templates.length > 0 ? (
          <Card size="panel">
            <StepUpForm action={startBatchAction.bind(null, org, event)} className="flex flex-col gap-4">
              <input type="hidden" name="requestKey" value={randomUUID()} />
              <fieldset className="flex flex-col gap-1.5">
                <legend className="pb-1.5 text-caption text-zinc-600">{tb('order')}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(['last_name', 'company'] as const).map((s) => (
                    <label key={s} className="flex min-h-6 items-center gap-2 text-body">
                      <input
                        type="radio"
                        name="sort"
                        value={s}
                        defaultChecked={s === 'last_name'}
                        className="size-5"
                      />
                      {tb(`sorts.${s}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {setup.ticketTypes.length > 1 ? (
                <fieldset className="flex flex-col gap-1.5" aria-describedby="batch-types-hint">
                  <legend className="pb-1.5 text-caption text-zinc-600">{tb('onlySomeTypes')}</legend>
                  <p id="batch-types-hint" className="text-caption text-zinc-500">
                    {tb('onlySomeTypesHint')}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {setup.ticketTypes.map((tt) => (
                      <label key={tt.id} className="flex min-h-6 items-center gap-2 text-body">
                        <input type="checkbox" name="ticketTypeIds" value={tt.id} className="size-5" />
                        {tt.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <div>
                <Button type="submit">{tb('createPdf')}</Button>
              </div>
            </StepUpForm>
          </Card>
        ) : null}
        {busy ? <AutoRefresh seconds={2} /> : null}
        {batches.length === 0 ? (
          <p className="text-body text-zinc-500">{tb('noBatches')}</p>
        ) : (
          <ol className="flex list-none flex-col gap-3 p-0" aria-label={tb('recentBatches')}>
            {batches.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-col gap-2">
                  <p className="text-body font-medium">
                    {tb(`status.${b.expired && b.status === 'done' ? 'expired' : b.status}`)}
                  </p>
                  <p className="text-caption text-zinc-600">{batchLine(b)}</p>
                  {b.status === 'queued' || b.status === 'running' ? (
                    <>
                      <progress
                        max={b.total}
                        value={b.processed}
                        aria-label={tb('progressLabel')}
                        className="h-2 w-full max-w-md accent-accent-900"
                      />
                      <p className="text-caption text-zinc-600">
                        {tb('progress', { processed: b.processed, total: b.total })}
                      </p>
                    </>
                  ) : (
                    <p className="text-caption text-zinc-600">{tb('badgeCount', { count: b.total })}</p>
                  )}
                  {b.skipped ? (
                    <p className="text-caption text-zinc-600">{tb('skipped', { count: b.skipped })}</p>
                  ) : null}
                  {b.status === 'failed' ? (
                    <p className="text-caption text-pink-700">{tb('failed')}</p>
                  ) : null}
                  {canExport ? (
                    <div className="flex flex-wrap gap-2">
                      {b.status === 'done' && !b.expired ? (
                        <a
                          href={`${raw}/batches/${b.id}/download`}
                          className={buttonClass('secondary', 'sm')}
                        >
                          {tb('download')}
                        </a>
                      ) : null}
                      {b.status === 'queued' || b.status === 'running' ? (
                        <form action={cancelBatchAction.bind(null, org, event, b.id)}>
                          <Button type="submit" variant="ghost" size="sm">
                            {tb('cancel')}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canPrintOne && setup.templates.length > 0 ? (
        <section aria-labelledby="one-heading" className="flex flex-col gap-3">
          <h2 id="one-heading" className="text-section">
            {tb('oneBadge')}
          </h2>
          <p className="max-w-prose text-caption text-zinc-500">{tb('oneBadgeHint')}</p>
          <form method="get" className="flex flex-wrap items-end gap-3" action={`${raw}#one-heading`}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="badge-q" className="text-caption text-zinc-600">
                {tb('findHolder')}
              </label>
              <input
                id="badge-q"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={80}
                className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
              />
            </div>
            <Button type="submit" variant="secondary">
              {tb('find')}
            </Button>
          </form>
          {q ? (
            found.length === 0 ? (
              <p className="text-body text-zinc-500">{tb('noneFound')}</p>
            ) : (
              <ul className="flex list-none flex-col gap-2 p-0">
                {found.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3">
                    <span className="text-body">
                      {f.holderName} · {f.typeName} · {tb('serial', { serial: f.serial })}
                    </span>
                    {f.paymentDue ? (
                      <>
                        {/* M5.1d: the invoice still has a balance: print only with a reason (audited). */}
                        <StatusDot status="warning" label={tb('balanceDue')} />
                        <details className="w-full">
                          <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                            {tb('printAnywayNamed', { name: f.holderName })}
                          </summary>
                          <div className="pt-2">
                            <ProgramForm
                              action={overrideBadgeAction.bind(null, org, event, f.id)}
                              fields={[
                                {
                                  kind: 'text',
                                  name: 'note',
                                  label: tb('overrideNote'),
                                  hint: tb('overrideHint'),
                                  required: true,
                                  maxLength: 300,
                                },
                              ]}
                              idPrefix={`badge-override-${f.id}`}
                              submitLabel={tb('printAnyway')}
                              successLabel={tb('printAnyway')}
                              errors={{ note: tb('overrideNoteRequired') }}
                            />
                          </div>
                        </details>
                      </>
                    ) : (
                      <a href={`${raw}/ticket/${f.id}`} className={buttonClass('ghost', 'sm')}>
                        {tb('badgePdf', { name: f.holderName })}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}
    </>
  );
}
