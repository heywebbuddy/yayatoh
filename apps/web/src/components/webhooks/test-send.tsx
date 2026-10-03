'use client';

import { Alert, Button, Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SendTestState } from '@/app/[locale]/o/[org]/(org)/webhooks/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Send a test message to this endpoint only (M6.3b): `webhook.test`, or any event's example. */
export function TestSend({
  action,
  types,
}: {
  action: (prev: SendTestState, form: FormData) => Promise<SendTestState>;
  types: readonly string[];
}) {
  const t = useTranslations('webhooks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as SendTestState);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('testTitle')}</h2>
      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="test-event-type" className="text-caption text-ink-2">
            {t('testEventType')}
          </label>
          <select
            id="test-event-type"
            name="eventType"
            defaultValue="webhook.test"
            aria-describedby="test-event-type-hint"
            className="min-h-10 self-start rounded-pill border border-line bg-surface-solid px-4 font-mono text-caption"
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <p id="test-event-type-hint" className="text-caption text-ink-2">
            {t('testHint')}
          </p>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {t('sendTest')}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.kind === 'sent' ? (
          <p role="status" className="text-body font-medium">
            {t('testSent', { type: state.eventType })}
          </p>
        ) : state.kind === 'error' ? (
          <Alert
            title={
              state.reason === 'webhooks_unavailable'
                ? t('unavailableTitle')
                : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </Card>
  );
}
