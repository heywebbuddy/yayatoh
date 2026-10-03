'use client';

import { OFFLINE_METHODS } from '@yayatoh/donations/collection';
import { Alert, Button, Input, Select, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { SettleState } from './actions.ts';

type Action = (prev: SettleState, form: FormData) => Promise<SettleState>;
const INITIAL: SettleState = { ok: null, message: '', stamp: 0 };

function Answer({ state }: { state: SettleState }) {
  return (
    <div aria-live="polite">
      {state.message ? <Alert tone={state.ok ? 'success' : 'danger'} title={state.message} /> : null}
    </div>
  );
}

/**
 * A pledge's host actions (M4.8e): record a payment received outside Yayatoh, or write the pledge
 * off with a note. Each behind a disclosure (native `<details>`: keyboard and screen readers),
 * each a plain form; the field to fix gets focus and its message.
 */
export function SettleForms({
  paddle,
  today,
  record,
  writeOff,
}: {
  paddle: number;
  today: string;
  record: Action;
  writeOff: Action;
}) {
  const t = useTranslations('pledges');
  const [recorded, recordAction, recording] = useActionState(record, INITIAL);
  const [written, writeAction, writing] = useActionState(writeOff, INITIAL);
  const recordRef = useRef<HTMLFormElement>(null);
  const writeRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (recorded.field) recordRef.current?.querySelector<HTMLElement>(`[name="${recorded.field}"]`)?.focus();
  }, [recorded]);
  useEffect(() => {
    if (written.field) writeRef.current?.querySelector<HTMLElement>(`[name="${written.field}"]`)?.focus();
  }, [written]);
  const idp = `p${paddle}`;
  return (
    <div className="flex flex-col gap-2">
      <details className="group">
        <summary className="inline-flex min-h-6 cursor-pointer items-center rounded-control px-1 font-semibold text-primary">
          {t('recordPayment')}
        </summary>
        <form ref={recordRef} action={recordAction} noValidate className="mt-2 flex flex-col gap-3">
          <Answer state={recorded} />
          <label className="flex flex-col gap-1.5 text-body font-semibold text-ink" htmlFor={`${idp}-method`}>
            {t('method')}
            <Select
              id={`${idp}-method`}
              name="method"
              defaultValue=""
              aria-invalid={recorded.field === 'method' ? true : undefined}
            >
              <option value="" disabled>
                {t('chooseMethod')}
              </option>
              {OFFLINE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`methods.${m}`)}
                </option>
              ))}
            </Select>
          </label>
          <Input id={`${idp}-reference`} name="reference" label={t('reference')} maxLength={120} />
          <Input
            id={`${idp}-receivedOn`}
            name="receivedOn"
            type="date"
            label={t('receivedOn')}
            defaultValue={today}
            max={today}
            error={recorded.field === 'receivedOn' ? recorded.message : undefined}
          />
          <Textarea id={`${idp}-note`} name="note" label={t('noteOptional')} maxLength={500} rows={2} />
          <Button type="submit" size="sm" disabled={recording} className="self-start">
            {t('recordSubmit', { paddle })}
          </Button>
        </form>
      </details>
      <details>
        <summary className="inline-flex min-h-6 cursor-pointer items-center rounded-control px-1 font-semibold text-ink-2">
          {t('writeOff')}
        </summary>
        <form ref={writeRef} action={writeAction} noValidate className="mt-2 flex flex-col gap-3">
          <Answer state={written} />
          <Textarea
            id={`${idp}-writeoff-note`}
            name="note"
            label={t('writeOffNote')}
            required
            maxLength={500}
            rows={2}
            error={written.field === 'note' ? written.message : undefined}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={writing} className="self-start">
            {t('writeOffSubmit', { paddle })}
          </Button>
        </form>
      </details>
    </div>
  );
}
