'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { ClaimState } from '@/app/[locale]/claim/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * Claim a ticket. M3.10c transfers: the recipient's name comes filled in and the email must be the
 * address the transfer was sent to.
 */
export function ClaimForm({
  action,
  defaultName,
  transfer = false,
}: {
  action: (prev: ClaimState, form: FormData) => Promise<ClaimState>;
  defaultName?: string;
  transfer?: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        name="name"
        required
        maxLength={120}
        autoComplete="name"
        label={t('claim.name')}
        defaultValue={defaultName}
      />
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        label={t('claim.email')}
        hint={transfer ? t('supportTools.claim.emailHint') : t('claim.emailHint')}
        aria-invalid={state.reason === 'email_mismatch' || undefined}
      />
      <div aria-live="polite">
        {state.code ? (
          <Alert
            title={
              state.reason === 'email_mismatch'
                ? t('supportTools.claim.emailMismatch')
                : t(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('claim.submit')}
      </Button>
    </form>
  );
}
