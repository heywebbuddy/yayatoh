'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type State = FormState & { readonly promoted?: number };

/**
 * "Promote now" for one session (M5.2b). Stays mounted when the line empties, so the result
 * ("2 people promoted") is still announced after the page refreshes; the button shows only while
 * someone waits.
 */
export function PromoteNow({
  action,
  title,
  waiting,
}: {
  action: (prev: State) => Promise<State>;
  title: string;
  waiting: number;
}) {
  const t = useTranslations('enrollment');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as State);
  const reason =
    state.reason && t.has(`errors.${state.reason}`)
      ? t(`errors.${state.reason}` as 'errors.promotion')
      : null;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {waiting > 0 ? (
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {t('promoteNow', { title })}
        </Button>
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? (
          <Alert
            tone={state.promoted ? 'success' : 'info'}
            title={t('promotedCount', { count: state.promoted ?? 0 })}
          />
        ) : null}
        {state.code ? <Alert title={reason ?? te(errorMessageKey(state.code))} /> : null}
      </div>
    </form>
  );
}
