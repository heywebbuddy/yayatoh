'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { RotateKeyState } from '@/app/[locale]/o/[org]/(org)/api-keys/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

const OVERLAPS = ['0', '1', '24', '168'] as const;

/**
 * Rotate one API key (M6.3a): choose how long the old key keeps working, confirm (step-up), and
 * copy the new key, shown once. A disclosure per row, so the table stays readable.
 */
export function ApiKeyRotate({
  id,
  name,
  action,
  timeZone,
  canRotate,
}: {
  id: string;
  name: string;
  action: (prev: RotateKeyState, form: FormData) => Promise<RotateKeyState>;
  /** The org's timezone, for the old key's end. */
  timeZone: string;
  /**
   * False once the key was rotated or expired. The component stays mounted for the row, so the
   * new key it just minted stays on screen after the list refreshes.
   */
  canRotate: boolean;
}) {
  const t = useTranslations('apiKeys');
  const te = useTranslations();
  const format = useFormatter();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as RotateKeyState);
  const [copied, setCopied] = useState(false);
  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const until = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const outcome = (
    <div aria-live="polite" className="flex flex-col gap-2">
      {state.kind === 'rotated' ? (
        <div className="flex flex-col gap-2 rounded-card border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-body font-medium">
            {state.previousUntil
              ? t('rotated', { name: state.name, until: until(state.previousUntil) })
              : t('rotatedNow', { name: state.name })}
          </p>
          <p className="text-body">{t('shownOnce')}</p>
          <code
            data-testid="rotated-api-key"
            className="break-all rounded-card bg-white px-3 py-2 font-mono text-caption"
          >
            {state.key}
          </code>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => copy(state.key)}>
              {t('copy')}
            </Button>
            <span role="status" className="text-caption text-zinc-600">
              {copied ? t('copied') : ''}
            </span>
          </div>
        </div>
      ) : state.kind === 'error' ? (
        <Alert title={te(errorMessageKey(state.code))} />
      ) : null}
    </div>
  );
  if (!canRotate) return state.kind === 'idle' ? null : outcome;
  return (
    <details className="group text-start">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-pill border border-zinc-200 bg-white px-3 text-caption font-medium [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true">{t('rotate')}</span>
        <span className="sr-only">{t('rotateNamed', { name })}</span>
      </summary>
      <div className="mt-2 flex min-w-[240px] flex-col gap-2">
        <form ref={formRef} action={formAction} className="flex flex-col gap-2">
          <label htmlFor={`overlap-${id}`} className="text-caption text-zinc-600">
            {t('overlap')}
          </label>
          <select
            id={`overlap-${id}`}
            name="overlapHours"
            defaultValue="24"
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          >
            {OVERLAPS.map((h) => (
              <option key={h} value={h}>
                {t(`overlapFor.h${h}`)}
              </option>
            ))}
          </select>
          <div>
            <Button type="submit" size="sm" disabled={pending} aria-label={t('rotateNowNamed', { name })}>
              {t('rotateNow')}
            </Button>
          </div>
        </form>
        {outcome}
      </div>
    </details>
  );
}
