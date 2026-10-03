'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { RefreshState } from './actions.ts';

/** The agency pages' one primary action: bring every client's numbers up to date. */
export function RefreshForm({ action }: { action: (prev: RefreshState) => Promise<RefreshState> }) {
  const t = useTranslations('agency');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as RefreshState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        {t('refresh')}
      </Button>
      <div aria-live="polite" className="w-full">
        {state.kind === 'done' ? (
          <Alert tone="success" title={t('refreshed', { count: state.clients })} />
        ) : state.kind === 'error' ? (
          <Alert title={tr(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </form>
  );
}
