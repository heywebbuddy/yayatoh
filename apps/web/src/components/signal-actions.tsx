'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SignalActionState } from '@/app/[locale]/o/[org]/e/[event]/onsite/signals/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Act = (prev: SignalActionState, form: FormData) => Promise<SignalActionState>;

/**
 * Acknowledge or dismiss one open signal. Keyed by the signal, so the confirmation stays after
 * the list re-renders with the new status.
 */
export function SignalActions({
  open,
  label,
  acknowledge,
  dismiss,
}: {
  open: boolean;
  /** What the signal is, for the buttons' accessible names. */
  label: string;
  acknowledge: Act;
  dismiss: Act;
}) {
  const t = useTranslations();
  const [ackState, ackAction, ackPending] = useActionState(acknowledge, { kind: 'idle' });
  const [disState, disAction, disPending] = useActionState(dismiss, { kind: 'idle' });
  const done = ackState.kind === 'done' ? ackState : disState.kind === 'done' ? disState : null;
  const failed = ackState.kind === 'error' ? ackState : disState.kind === 'error' ? disState : null;
  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <div className="flex flex-wrap gap-2">
          <form action={ackAction}>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={ackPending || disPending}
              aria-label={t('signals.acknowledgeFor', { what: label })}
            >
              {t('signals.acknowledge')}
            </Button>
          </form>
          <form action={disAction}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={ackPending || disPending}
              aria-label={t('signals.dismissFor', { what: label })}
            >
              {t('signals.dismiss')}
            </Button>
          </form>
        </div>
      ) : null}
      <div aria-live="polite">
        {done ? <Alert tone="info" title={t(`signals.done.${done.status}`)} /> : null}
        {failed ? <Alert title={t(errorMessageKey(failed.code))} /> : null}
      </div>
    </div>
  );
}
