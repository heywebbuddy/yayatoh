'use client';

import { Alert, Button, Card, Table } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { AgendaImportState } from '@/app/[locale]/o/[org]/e/[event]/sessions/import/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const FILE_ERRORS = [
  'no_file',
  'too_large',
  'empty',
  'too_many_rows',
  'too_many_columns',
  'cell_too_long',
  'unterminated_quote',
  'missing_columns',
];
const INITIAL: AgendaImportState = { ok: false, error: null };

/**
 * The agenda CSV import (M5.2a): choose a file → "Check file" (a dry run: every row's result,
 * nothing written) → "Import" (the checked text again; idempotent). Plain forms and a table:
 * keyboard-only by construction.
 */
export function AgendaImport({
  check,
  apply,
}: {
  check: (prev: AgendaImportState, form: FormData) => Promise<AgendaImportState>;
  apply: (prev: AgendaImportState, form: FormData) => Promise<AgendaImportState>;
}) {
  const t = useTranslations('agenda.import');
  const te = useTranslations();
  const [checked, checkAction, checking] = useActionState(check, INITIAL);
  const [applied, applyAction, applying] = useActionState(apply, INITIAL);
  // The newest of the two results is the one on screen.
  const current = (applied.stamp ?? 0) > (checked.stamp ?? 0) ? applied : checked;
  const error = !checking && !applying && !current.ok ? current.error : null;
  const errorText = error
    ? FILE_ERRORS.includes(error)
      ? t(`fileError.${error}`)
      : te(errorMessageKey(error))
    : null;
  const r = current.ok ? current.result : undefined;
  const wasApplied = r?.applied === true;
  const toApply = r ? r.created + r.updated : 0;
  const counts = r
    ? { create: r.created, update: r.updated, unchanged: r.unchanged, error: r.failed }
    : { create: 0, update: 0, unchanged: 0, error: 0 };
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <form action={checkAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="agenda-file" className="text-caption text-zinc-600">
              {t('file')}
            </label>
            <input
              id="agenda-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              aria-invalid={error === 'no_file' ? true : undefined}
              aria-describedby={errorText ? 'agenda-import-error' : undefined}
              className="min-h-10 text-body file:me-3 file:min-h-10 file:rounded-pill file:border file:border-zinc-200 file:bg-white file:px-4"
            />
          </div>
          <Button type="submit" variant={r && !wasApplied ? 'secondary' : 'primary'} disabled={checking}>
            {t('check')}
          </Button>
        </form>
        <div aria-live="polite">
          {errorText ? (
            <p id="agenda-import-error" role="alert" className="text-body text-pink-700">
              {errorText}
            </p>
          ) : null}
        </div>
      </Card>
      {r ? (
        <section aria-labelledby="agenda-import-result" className="flex flex-col gap-3">
          <h2 id="agenda-import-result" className="text-section">
            {t('checked', { file: current.fileName ?? '' })}
          </h2>
          <div aria-live="polite">
            {wasApplied ? (
              <Alert tone="info" title={t('applied', counts)} />
            ) : (
              <p className="text-body" role="status">
                {t('summary', counts)}
              </p>
            )}
          </div>
          <Table
            caption={t('rows')}
            captionHidden={false}
            rowKey={(row) => String(row.line)}
            rows={r.rows}
            columns={[
              { key: 'line', header: t('line'), cell: (row) => row.line, mono: true },
              { key: 'title', header: t('sessionTitle'), cell: (row) => row.title || '—' },
              {
                key: 'result',
                header: t('result'),
                cell: (row) =>
                  row.action === 'error' ? (
                    <span className="text-pink-700" data-row-result="error">
                      {t(`${wasApplied ? 'done' : 'action'}.error`)}:{' '}
                      {row.errors.map((e) => t(`rowError.${e}`)).join(' ')}
                    </span>
                  ) : (
                    <span data-row-result={row.action}>
                      {t(`${wasApplied ? 'done' : 'action'}.${row.action}`)}
                    </span>
                  ),
              },
            ]}
          />
          {!wasApplied ? (
            toApply > 0 ? (
              <form action={applyAction}>
                <input type="hidden" name="csv" value={current.csv ?? ''} />
                <Button type="submit" disabled={applying}>
                  {t('apply', { count: toApply })}
                </Button>
              </form>
            ) : (
              <p className="text-body text-zinc-600">{t('nothingToApply')}</p>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
