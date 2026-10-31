'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SelfServeState } from '@/app/[locale]/signup/self-serve-actions.ts';

/** "Try the payment again" and "Open my organization for now". */
export function PayRetry({
  retry,
  skip,
  org,
  plan,
  interval,
  available,
}: {
  retry: (prev: SelfServeState, form: FormData) => Promise<SelfServeState>;
  skip: (form: FormData) => Promise<void>;
  org: string;
  plan: string;
  interval: 'month' | 'year';
  available: boolean;
}) {
  const t = useTranslations('selfServe');
  const [state, formAction, pending] = useActionState(retry, { error: null });
  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">{state.error ? <Alert title={t(`errors.${state.error}`)} /> : null}</div>
      <div className="flex flex-wrap gap-3">
        {available ? (
          <form action={formAction}>
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="plan" value={plan} />
            <input type="hidden" name="interval" value={interval} />
            <Button type="submit" disabled={pending}>
              {t('pay.retry')}
            </Button>
          </form>
        ) : null}
        <form action={skip}>
          <input type="hidden" name="org" value={org} />
          <Button type="submit" variant="secondary">
            {t('pay.skip')}
          </Button>
        </form>
      </div>
    </div>
  );
}
