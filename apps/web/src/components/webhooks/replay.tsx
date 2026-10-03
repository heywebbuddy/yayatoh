'use client';

import { Alert, Button, Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { ReplayState } from '@/app/[locale]/o/[org]/(org)/webhooks/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Resend one delivered message to the endpoint (a row action of the deliveries table). */
export function ResendButton({
  action,
  label,
}: {
  action: (prev: ReplayState, form: FormData) => Promise<ReplayState>;
  /** Names the message for screen readers ("Resend order.paid of 10:04"). */
  label: string;
}) {
  const t = useTranslations('webhooks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as ReplayState);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label={label}>
        {t('resend')}
      </Button>
      <span aria-live="polite" className="text-caption text-ink-2">
        {state.kind === 'resent'
          ? t('resent')
          : state.kind === 'error'
            ? te(errorMessageKey(state.code))
            : ''}
      </span>
    </form>
  );
}

/** Resend every failed message since a time (after the receiver was down). */
export function RecoverForm({
  action,
}: {
  action: (prev: ReplayState, form: FormData) => Promise<ReplayState>;
}) {
  const t = useTranslations('webhooks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as ReplayState);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('recoverTitle')}</h2>
      <p className="text-body text-ink-2">{t('recoverHint')}</p>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="recover-window" className="text-caption text-ink-2">
            {t('recoverSince')}
          </label>
          <select
            id="recover-window"
            name="window"
            defaultValue="24h"
            className="min-h-10 rounded-pill border border-line bg-surface-solid px-4 text-body"
          >
            {(['1h', '24h', '7d'] as const).map((w) => (
              <option key={w} value={w}>
                {t(`recoverWindow.${w}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('recover')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'recovering' ? (
          <p role="status" className="text-body font-medium">
            {t('recovering')}
          </p>
        ) : state.kind === 'error' ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
