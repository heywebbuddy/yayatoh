'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { HolderLinkState } from '@/app/[locale]/events/[slug]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** "Already have tickets? Email me a link to them." */
export function HolderLinkForm({
  action,
}: {
  action: (prev: HolderLinkState, form: FormData) => Promise<HolderLinkState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { sent: false, code: null });
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <p className="text-body text-ink-2">{t('myTickets.requestHint')}</p>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="holder-email" className="text-caption text-ink-2">
            {t('myTickets.requestEmail')}
          </label>
          <input
            id="holder-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('myTickets.requestSend')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.sent ? <p className="text-body">{t('myTickets.requestSent')}</p> : null}
        {state.code ? (
          <Alert
            title={
              state.code === 'rate_limited'
                ? t('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
                : t(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </div>
  );
}
