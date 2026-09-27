'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

export type ClaimLinkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'link'; readonly token: string; readonly emailed: boolean }
  | { readonly kind: 'error'; readonly code: string };

/**
 * Create a claim link for one ticket: optionally emailed, always shown once to copy and share
 * (a text message, a chat). Whoever claims it becomes the ticket's holder.
 */
export function ClaimLinkForm({
  action,
  idPrefix,
  submitLabel,
}: {
  action: (prev: ClaimLinkState, form: FormData) => Promise<ClaimLinkState>;
  idPrefix: string;
  submitLabel: string;
}) {
  const t = useTranslations('distribution');
  const tt = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const url = (token: string) =>
    `${typeof window === 'undefined' ? '' : window.location.origin}${locale === 'en' ? '' : `/${locale}`}/claim/${token}`;
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-email`} className="text-caption text-zinc-600">
            {t('recipient')}
          </label>
          <input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            autoComplete="off"
            aria-describedby={`${idPrefix}-hint`}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          />
          <span id={`${idPrefix}-hint`} className="text-caption text-zinc-500">
            {t('recipientHint')}
          </span>
        </div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'link' ? (
          <div className="flex flex-col gap-1.5 rounded-card border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-caption">{state.emailed ? t('linkEmailed') : t('linkReady')}</p>
            <input
              readOnly
              aria-label={t('linkLabel')}
              value={url(state.token)}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="claim-link"
              className="min-h-10 w-full rounded-pill border border-zinc-200 bg-white px-4 font-mono text-caption"
            />
          </div>
        ) : state.kind === 'error' ? (
          <Alert title={tt(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </div>
  );
}
