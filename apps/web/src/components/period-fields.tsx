'use client';

import { Button, DatePicker, FieldMessage, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { PERIODS, type Period } from '@/lib/period.ts';

/**
 * The period fields of a GET report form (QA #32): one rule, a preset or custom days. From and To
 * show only for "Custom dates", under one hint that covers both; Apply waits for a full forward
 * range there. `children` go between the dates and Apply (the Money overview's grain).
 */
export function PeriodFields({
  idPrefix,
  period,
  from,
  to,
  error,
  children,
}: {
  idPrefix: string;
  period: Period;
  from?: string;
  to?: string;
  /** The server's message for custom dates it could not use. */
  error?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('reports.org');
  const [chosen, setChosen] = useState<string>(period);
  const [start, setStart] = useState(from ?? '');
  const [end, setEnd] = useState(to ?? '');
  const [edited, setEdited] = useState(false);
  const custom = chosen === 'custom';
  const backwards = Boolean(start && end && start > end);
  const ready = !custom || (Boolean(start && end) && !backwards);
  // The server's message stands until the dates change; a backwards range is said at once.
  const problem = backwards ? t('badRange') : edited ? undefined : error;
  const rangeId = `${idPrefix}-range`;
  const describedBy = problem ? `${rangeId}-error` : `${rangeId}-hint`;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-period`} className="text-[13px] font-bold text-ink">
          {t('period')}
        </label>
        <Select
          id={`${idPrefix}-period`}
          name="period"
          defaultValue={period}
          onValueChange={setChosen}
          className="field"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`periods.${p}`)}
            </option>
          ))}
        </Select>
      </div>
      {custom ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="sr-only">{t('periods.custom')}</legend>
          <div className="flex flex-wrap items-start gap-3">
            <DatePicker
              name="from"
              id={`${idPrefix}-from`}
              label={t('from')}
              defaultValue={start}
              required
              onValueChange={(v) => {
                setStart(v);
                setEdited(true);
              }}
              aria-describedby={describedBy}
            />
            <DatePicker
              name="to"
              id={`${idPrefix}-to`}
              label={t('to')}
              defaultValue={end}
              required
              onValueChange={(v) => {
                setEnd(v);
                setEdited(true);
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={describedBy}
            />
          </div>
          <div aria-live="polite">
            <FieldMessage id={rangeId} error={problem} hint={t('customHint')} />
          </div>
        </fieldset>
      ) : null}
      {children}
      <Button type="submit" variant="secondary" className="mt-[22px]" disabled={!ready}>
        {t('apply')}
      </Button>
    </>
  );
}
