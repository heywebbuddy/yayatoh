import {
  GUEST_IMPORT_FIELDS,
  GUEST_IMPORT_REJECTIONS,
  type GuestImportSummaryDto,
  guestImportBulk,
  guestImportSummaryQuery,
} from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  pasteImportAction,
  sheetImportAction,
  startImportAction,
  uploadImportAction,
  validateImportAction,
} from './actions.ts';

const UUID = /^[0-9a-f-]{36}$/;
/** Reader and step reasons with their own message (others fall back to the generic error). */
const REASONS = new Set([
  'empty',
  'too_large',
  'too_many_rows',
  'too_many_columns',
  'cell_too_long',
  'unterminated_quote',
  'not_a_spreadsheet',
  'sheet_not_found',
  'old_excel',
  'sheet_url',
  'sheet_private',
  'sheet_missing',
  'sheet_unavailable',
  'sheet_blocked',
  'name_required',
  'unknown_column',
  'already_imported',
  'not_validated',
  'nothing_to_import',
  'expired',
]);
const REJECTIONS = new Set<string>(GUEST_IMPORT_REJECTIONS);

const field = 'flex flex-col gap-1.5';
const label = 'text-caption text-ink-2';
const control = 'field';

/**
 * Guest-list import (M4.1b): paste, a CSV or XLSX file, or a Google Sheet link → match the
 * columns → check the parties that will be created and the rows that can't be → import. Hosts,
 * co-hosts and planners (`guests:write`); a viewer sees why they can't.
 */
export default async function GuestImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ batch?: string; error?: string; op?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!PROFILES[profile].nav.some((i) => i.key === 'guests') || !navIncludes(profile, data.modules, 'guests'))
    notFound();
  const t = await getTranslations('guestImport');
  const tp = await getTranslations('parties');
  const te = await getTranslations();
  const guestsHref = `/o/${org}/e/${event}/guests`;
  const back = (
    <Link href={guestsHref} className={buttonClass('secondary')}>
      {t('backToGuests')}
    </Link>
  );
  if (!can('guests:write'))
    return (
      <>
        <PageHeader title={t('title')} actions={back} />
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} />
      </>
    );

  const n = (v: number) => formatNumber(v, locale);
  const [code, reason] = (sp.error ?? '').split(':');
  const errorText = sp.error
    ? reason && REASONS.has(reason)
      ? t(`error.${reason}` as 'error.empty')
      : te(errorMessageKey(code))
    : null;
  const batchId = sp.batch && UUID.test(sp.batch) ? sp.batch : null;
  const s: GuestImportSummaryDto | null = batchId
    ? await executeQuery(guestImportSummaryQuery, { eventId: ev.id, batchId }, data.ctx, ports).catch(
        (err) => {
          if (isDomainError(err) && err.code === 'not_found') return null;
          throw err;
        },
      )
    : null;
  const op =
    s && sp.op && UUID.test(sp.op)
      ? await executeQuery(guestImportBulk.status, { operationId: sp.op }, data.ctx, ports).catch(() => null)
      : null;
  const running = s?.status === 'importing' && (!op || op.status === 'queued' || op.status === 'running');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const rejectedHref = s ? `${prefix}${guestsHref}/import/${s.batchId}/rejected` : '';
  const sourceLabel = (x: GuestImportSummaryDto) =>
    x.source === 'paste'
      ? t('source.paste')
      : x.source === 'sheet'
        ? t('source.sheet')
        : x.source === 'xlsx'
          ? t('source.xlsx', { file: x.fileName || 'guests.xlsx', sheet: x.sheet ?? '' })
          : t('source.csv', { file: x.fileName || 'guests.csv' });
  const reasonText = (c: string) => (REJECTIONS.has(c) ? t(`reason.${c}` as 'reason.missing_name') : c);
  const nameOrRow = (name: string | null, rowNo: number) => name ?? t('rowN', { n: rowNo });

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={back} />
      {errorText ? (
        <p
          role="alert"
          className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
        >
          {errorText}
        </p>
      ) : null}
      <p className="text-caption text-ink-2">{t('privacyNote')}</p>

      {!s ? (
        <section aria-labelledby="import-step1" className="flex flex-col gap-4">
          <h2 id="import-step1" className="text-section">
            {t('step1')}
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="flex flex-col gap-3">
              <h3 id="import-paste" className="text-body font-medium">
                {t('pasteHeading')}
              </h3>
              <form
                action={pasteImportAction.bind(null, org, event)}
                aria-labelledby="import-paste"
                className="flex flex-col gap-3"
              >
                <div className={field}>
                  <label htmlFor="import-text" className={label}>
                    {t('pasteLabel')}
                  </label>
                  <textarea
                    id="import-text"
                    name="text"
                    required
                    rows={8}
                    aria-describedby="import-text-hint"
                    spellCheck={false}
                    className="rounded-card border border-line bg-surface px-4 py-2 font-mono text-caption"
                  />
                  <p id="import-text-hint" className="text-caption text-ink-2">
                    {t('pasteHint')}
                  </p>
                </div>
                <div>
                  <Button type="submit">{t('pasteSubmit')}</Button>
                </div>
              </form>
            </Card>
            <Card className="flex flex-col gap-3">
              <h3 id="import-upload" className="text-body font-medium">
                {t('fileHeading')}
              </h3>
              <form
                action={uploadImportAction.bind(null, org, event)}
                aria-labelledby="import-upload"
                className="flex flex-col gap-3"
              >
                <div className={field}>
                  <label htmlFor="import-file" className={label}>
                    {t('fileLabel')}
                  </label>
                  <input
                    id="import-file"
                    name="file"
                    type="file"
                    required
                    aria-describedby="import-file-hint"
                    accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="min-h-10 text-body file:me-3 file:min-h-10 file:rounded-pill file:border file:border-line file:bg-surface file:px-4"
                  />
                  <p id="import-file-hint" className="text-caption text-ink-2">
                    {t('fileHint')}
                  </p>
                </div>
                <div className={field}>
                  <label htmlFor="import-sheet" className={label}>
                    {t('sheetLabel')}
                  </label>
                  <input
                    id="import-sheet"
                    name="sheet"
                    maxLength={200}
                    aria-describedby="import-sheet-hint"
                    className={control}
                  />
                  <p id="import-sheet-hint" className="text-caption text-ink-2">
                    {t('sheetHint')}
                  </p>
                </div>
                <div>
                  <Button type="submit">{t('fileSubmit')}</Button>
                </div>
              </form>
            </Card>
            <Card className="flex flex-col gap-3">
              <h3 id="import-google" className="text-body font-medium">
                {t('googleHeading')}
              </h3>
              <form
                action={sheetImportAction.bind(null, org, event)}
                aria-labelledby="import-google"
                className="flex flex-col gap-3"
              >
                <div className={field}>
                  <label htmlFor="import-url" className={label}>
                    {t('googleLabel')}
                  </label>
                  <input
                    id="import-url"
                    name="url"
                    type="url"
                    required
                    inputMode="url"
                    maxLength={2000}
                    aria-describedby="import-url-hint"
                    className={control}
                  />
                  <p id="import-url-hint" className="text-caption text-ink-2">
                    {t('googleHint')}
                  </p>
                </div>
                <div>
                  <Button type="submit">{t('googleSubmit')}</Button>
                </div>
              </form>
            </Card>
          </div>
        </section>
      ) : s.expired ? (
        <EmptyState
          title={t('expiredTitle')}
          description={t('expired')}
          action={
            <Link href={`${guestsHref}/import`} className={buttonClass('primary')}>
              {t('startAgain')}
            </Link>
          }
        />
      ) : (
        <>
          {s.status === 'staged' || s.status === 'validated' ? (
            <section aria-labelledby="import-step2" className="flex flex-col gap-3">
              <Card className="flex flex-col gap-4">
                <h2 id="import-step2" className="text-section">
                  {t('step2')}
                </h2>
                <p className="text-body text-ink-2">
                  {sourceLabel(s)} · {t('rows', { count: s.rowCount })}
                </p>
                {s.sheets.length > 1 ? (
                  <p className="text-caption text-ink-2">
                    {t('otherSheets', { sheets: s.sheets.filter((x) => x !== s.sheet).join(', ') })}
                  </p>
                ) : null}
                <p className="text-caption text-ink-2">{t('mappingHint')}</p>
                <form
                  action={validateImportAction.bind(null, org, event, s.batchId)}
                  aria-label={t('step2')}
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
                >
                  {GUEST_IMPORT_FIELDS.map((f) => (
                    <div key={f} className={field}>
                      <label htmlFor={`map-${f}`} className={label}>
                        {t(`field.${f}`)}
                      </label>
                      <select id={`map-${f}`} name={f} defaultValue={s.mapping[f] ?? ''} className={control}>
                        <option value="">{t('notInList')}</option>
                        {s.headers.map((h, i) => (
                          <option key={`${i}-${h}`} value={i}>
                            {h || t('columnN', { n: i + 1 })}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Button type="submit" variant={s.status === 'validated' ? 'secondary' : 'primary'}>
                      {t('check')}
                    </Button>
                  </div>
                </form>
              </Card>
              {s.sample.length ? (
                <Table
                  caption={t('sampleCaption')}
                  captionHidden={false}
                  rowKey={(r) => r.key}
                  rows={s.sample.map((cells, i) => ({ key: String(i), cells }))}
                  columns={s.headers.map((h, i) => ({
                    key: String(i),
                    header: h || t('columnN', { n: i + 1 }),
                    cell: (r: { cells: string[] }) => r.cells[i] ?? '',
                  }))}
                />
              ) : null}
            </section>
          ) : null}

          {s.status === 'validated' ? (
            <section id="check" aria-labelledby="import-step3" className="flex flex-col gap-3">
              <h2 id="import-step3" className="text-section">
                {t('step3')}
              </h2>
              <p className="text-body" role="status">
                {t('summary', { parties: s.partiesPlanned, guests: s.guestsPlanned })}{' '}
                {s.rejected ? t('rejectedSummary', { count: s.rejected }) : null}
              </p>
              {s.rejected ? (
                <ul
                  aria-label={t('reasonsLabel')}
                  className="flex list-none flex-col gap-1 p-0 text-caption text-danger"
                >
                  {GUEST_IMPORT_REJECTIONS.filter((c) => s.rejectedByCode[c]).map((c) => (
                    <li key={c}>
                      {reasonText(c)} · {n(s.rejectedByCode[c] ?? 0)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {s.preview.length ? (
                <section aria-labelledby="import-preview" className="flex flex-col gap-2">
                  <h3 id="import-preview" className="text-body font-medium">
                    {t('previewHeading')}
                  </h3>
                  <ol className="grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
                    {s.preview.map((p, i) => (
                      <li key={`${i}-${p.name}`}>
                        <Card className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-body font-medium">{p.name}</h4>
                            {p.vip ? (
                              <span className="rounded-pill bg-primary-soft px-2 py-px text-caption text-primary-ink">
                                {tp('vip')}
                              </span>
                            ) : null}
                            {p.side ? (
                              <span className="rounded-pill bg-surface-3 px-2 py-px text-caption text-ink-2">
                                {tp('sideValue', { side: p.side })}
                              </span>
                            ) : null}
                            {p.tags.map((x) => (
                              <span
                                key={x}
                                className="rounded-pill bg-surface-3 px-2 py-px text-caption text-ink-2"
                              >
                                {x}
                              </span>
                            ))}
                          </div>
                          <ul
                            aria-label={tp('guestsOf', { party: p.name })}
                            className="flex list-none flex-col gap-1 p-0 text-caption"
                          >
                            {p.guests.map((g, j) => {
                              const name = [g.firstName, g.lastName].filter(Boolean).join(' ');
                              return (
                                <li
                                  key={`${j}-${name}`}
                                  className="ps-0 data-[plus=true]:ps-6"
                                  data-plus={g.kind === 'plus_one'}
                                >
                                  {g.kind === 'plus_one'
                                    ? name
                                      ? t('plusOneNamed', { name, host: g.guestOf ?? '?' })
                                      : tp('guestOf', { name: g.guestOf ?? '?' })
                                    : name}
                                  {g.ageClass !== 'adult' ? ` · ${tp(`ages.${g.ageClass}`)}` : ''}
                                </li>
                              );
                            })}
                          </ul>
                        </Card>
                      </li>
                    ))}
                  </ol>
                  {s.partiesPlanned > s.preview.length ? (
                    <p className="text-caption text-ink-2">
                      {t('previewMore', { count: s.partiesPlanned - s.preview.length })}
                    </p>
                  ) : null}
                </section>
              ) : null}
              {s.rejectedRows.length ? (
                <Table
                  caption={t('rejectedCaption')}
                  captionHidden={false}
                  rowKey={(r) => String(r.rowNo)}
                  rows={s.rejectedRows}
                  columns={[
                    { key: 'row', header: t('row'), cell: (r) => r.rowNo, mono: true },
                    { key: 'name', header: t('name'), cell: (r) => nameOrRow(r.name, r.rowNo) },
                    { key: 'problem', header: t('problem'), cell: (r) => reasonText(r.code) },
                  ]}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {s.partiesPlanned > 0 ? (
                  <form action={startImportAction.bind(null, org, event, s.batchId)}>
                    <Button type="submit">{t('start', { count: s.partiesPlanned })}</Button>
                  </form>
                ) : (
                  <p className="text-body text-ink-2">{t('error.nothing_to_import')}</p>
                )}
                {s.rejected ? (
                  <a href={rejectedHref} className={buttonClass('secondary')} download>
                    {t('download')}
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {s.status === 'importing' || s.status === 'imported' ? (
            <section
              aria-labelledby="import-result"
              className="flex flex-col gap-3 rounded-panel border border-line bg-surface px-5 py-4"
            >
              {running ? <AutoRefresh seconds={2} /> : null}
              <h2 id="import-result" className="text-section">
                {s.status === 'imported' ? t('doneHeading') : t('importingHeading')}
              </h2>
              {s.status === 'importing' ? (
                <progress
                  value={op?.processed ?? 0}
                  max={Math.max(1, op?.total ?? s.partiesPlanned)}
                  aria-label={t('progress', {
                    done: n(op?.processed ?? 0),
                    total: n(op?.total ?? s.partiesPlanned),
                  })}
                  className="h-2 w-full accent-primary"
                />
              ) : null}
              <p className="text-body" role="status">
                {s.status === 'imported'
                  ? t('done', { parties: s.partiesImported, guests: s.guestsImported })
                  : t('progress', {
                      done: n(op?.processed ?? 0),
                      total: n(op?.total ?? s.partiesPlanned),
                    })}
              </p>
              {s.rejected ? (
                <p className="text-caption text-danger">{t('rejectedSummary', { count: s.rejected })}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Link href={guestsHref} className={buttonClass('primary')}>
                  {t('seeGuests')}
                </Link>
                {s.rejected ? (
                  <a href={rejectedHref} className={buttonClass('secondary')} download>
                    {t('download')}
                  </a>
                ) : null}
                <Link href={`${guestsHref}/import`} className={buttonClass('secondary')}>
                  {t('startAgain')}
                </Link>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
