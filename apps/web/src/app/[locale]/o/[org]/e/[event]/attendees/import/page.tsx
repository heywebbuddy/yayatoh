import { IMPORT_ERROR_CODES, importSummaryQuery } from '@yayatoh/attendees';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { startImportAction, uploadImportAction, validateImportAction } from './actions.ts';

const FIELDS = ['name', 'email', 'labels'] as const;
const CSV_REASONS = [
  'empty',
  'too_large',
  'too_many_rows',
  'too_many_columns',
  'cell_too_long',
  'unterminated_quote',
];

/** Guest-list import: upload a CSV → map columns and check rows → import (an undoable job). */
export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ batch?: string; error?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'attendees');
  const t = await getTranslations();
  const back = `/o/${org}/e/${event}/attendees`;
  if (!can('attendees:write') || !data.modules.has('attendees')) {
    return (
      <>
        <PageHeader title={t('import.title')} />
        <EmptyState title={t('import.noAccessTitle')} description={t('import.noAccessDescription')} />
      </>
    );
  }
  const [code, reason] = (sp.error ?? '').split(':');
  const errorText = sp.error
    ? reason && CSV_REASONS.includes(reason)
      ? t(`import.csvError.${reason}`)
      : t(errorMessageKey(code))
    : null;
  const batchId = sp.batch && /^[0-9a-f-]{36}$/.test(sp.batch) ? sp.batch : null;
  const s = batchId
    ? await executeQuery(importSummaryQuery, { eventId: ev.id, batchId }, data.ctx, ports).catch((err) => {
        if (isDomainError(err) && err.code === 'not_found') return null;
        throw err;
      })
    : null;
  const invalid = s ? Object.values(s.invalidByCode).reduce((n, x) => n + x, 0) : 0;
  const prefix = locale === 'en' ? '' : `/${locale}`;

  return (
    <>
      <PageHeader
        title={t('import.title')}
        description={t('import.description')}
        actions={
          <Link href={back} className={buttonClass('secondary')}>
            {t('import.backToList')}
          </Link>
        }
      />
      {errorText ? (
        <p
          role="alert"
          className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-body text-danger"
        >
          {errorText}
        </p>
      ) : null}
      {!s ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-section">{t('import.step1')}</h2>
          <p className="text-body text-ink-2">{t('import.fileHint')}</p>
          <form action={uploadImportAction.bind(null, org, event)} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="import-file" className="text-caption text-ink-2">
                {t('import.file')}
              </label>
              <input
                id="import-file"
                name="file"
                type="file"
                required
                accept=".csv,text/csv"
                className="min-h-10 text-body file:me-3 file:min-h-10 file:rounded-pill file:border file:border-line file:bg-surface file:px-4"
              />
            </div>
            <Button type="submit">{t('import.upload')}</Button>
          </form>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <h2 className="text-section">{t('import.step2', { file: s.fileName })}</h2>
            <p className="text-body text-ink-2">
              {t('import.rows', { count: s.rowCount, formatted: formatNumber(s.rowCount, locale) })}
            </p>
            <form
              action={validateImportAction.bind(null, org, event, s.batchId)}
              className="grid grid-cols-1 gap-4 md:grid-cols-4"
            >
              {FIELDS.map((f) => (
                <div key={f} className="flex flex-col gap-1.5">
                  <label htmlFor={`map-${f}`} className="text-caption text-ink-2">
                    {t(`import.field.${f}`)}
                  </label>
                  <select
                    id={`map-${f}`}
                    name={f}
                    required={f === 'email'}
                    defaultValue={s.mapping[f] ?? ''}
                    className="field"
                  >
                    <option value="">
                      {f === 'email' ? t('import.chooseColumn') : t('import.notInFile')}
                    </option>
                    {s.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || t('import.columnN', { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="extra-label" className="text-caption text-ink-2">
                  {t('import.extraLabel')}
                </label>
                <input
                  id="extra-label"
                  name="extraLabel"
                  maxLength={40}
                  defaultValue={s.extraLabels[0] ?? ''}
                  className="field"
                />
              </div>
              <div className="md:col-span-4">
                <Button type="submit" variant={s.validated ? 'secondary' : 'primary'}>
                  {t('import.check')}
                </Button>
              </div>
            </form>
          </Card>
          {s.validated ? (
            <section aria-labelledby="import-check-heading" className="flex flex-col gap-3">
              <h2 id="import-check-heading" className="text-section">
                {t('import.step3')}
              </h2>
              <p className="text-body" role="status">
                {t('import.summary', {
                  valid: formatNumber(s.valid, locale),
                  invalid: formatNumber(invalid, locale),
                })}
              </p>
              {invalid > 0 ? (
                <ul className="flex list-none flex-col gap-1 p-0 text-caption text-danger">
                  {IMPORT_ERROR_CODES.filter((c) => s.invalidByCode[c]).map((c) => (
                    <li key={c}>
                      {t(`import.reason.${c}`)} · {formatNumber(s.invalidByCode[c] ?? 0, locale)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Table
                caption={t('import.preview')}
                captionHidden={false}
                rowKey={(r) => String(r.rowNo)}
                rows={s.preview}
                columns={[
                  { key: 'row', header: t('import.row'), cell: (r) => r.rowNo, mono: true },
                  { key: 'name', header: t('import.field.name'), cell: (r) => r.name },
                  { key: 'email', header: t('import.field.email'), cell: (r) => r.email },
                  { key: 'labels', header: t('import.field.labels'), cell: (r) => r.labels.join(', ') },
                  {
                    key: 'check',
                    header: t('import.result'),
                    cell: (r) => (r.errorCode ? t(`import.reason.${r.errorCode}`) : t('import.ok')),
                  },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {s.valid > 0 && s.imported === 0 ? (
                  <form action={startImportAction.bind(null, org, event, s.batchId)}>
                    <Button type="submit">
                      {t('import.start', { count: s.valid, formatted: formatNumber(s.valid, locale) })}
                    </Button>
                  </form>
                ) : null}
                {invalid > 0 ? (
                  <a
                    href={`${prefix}${back}/import/${s.batchId}/failures`}
                    className={buttonClass('secondary')}
                    download
                  >
                    {t('import.downloadProblems')}
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
