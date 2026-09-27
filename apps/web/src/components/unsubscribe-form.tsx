'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { UnsubscribeState } from '@/app/[locale]/unsubscribe/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** One button: unsubscribe, then "Subscribe again" to undo. The outcome is announced. */
export function UnsubscribeForm({
  action,
  initial,
  org,
  category,
}: {
  action: (prev: UnsubscribeState, form: FormData) => Promise<UnsubscribeState>;
  initial: boolean;
  org: string;
  category: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { unsubscribed: initial, code: null });
  const what = t(`unsubscribe.categoryName.${category}`);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div role="status" aria-live="polite" className="text-body">
        {state.unsubscribed ? (
          <p className="font-medium">{t('unsubscribe.done', { org, what })}</p>
        ) : (
          <p>{t('unsubscribe.question', { org, what })}</p>
        )}
      </div>
      {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      <input type="hidden" name="intent" value={state.unsubscribed ? 'resubscribe' : 'unsubscribe'} />
      <Button
        type="submit"
        variant={state.unsubscribed ? 'secondary' : 'primary'}
        disabled={pending}
        className="self-start"
      >
        {state.unsubscribed ? t('unsubscribe.resubscribe') : t('unsubscribe.confirm')}
      </Button>
    </form>
  );
}
