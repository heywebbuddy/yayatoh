'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { ClaimState } from '@/app/[locale]/claim/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function ClaimForm({ action }: { action: (prev: ClaimState, form: FormData) => Promise<ClaimState> }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input name="name" required maxLength={120} autoComplete="name" label={t('claim.name')} />
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        label={t('claim.email')}
        hint={t('claim.emailHint')}
      />
      <div aria-live="polite">{state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}</div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('claim.submit')}
      </Button>
    </form>
  );
}
