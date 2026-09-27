'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState } from 'react';
import type { SettingsState } from '@/app/[locale]/o/[org]/(org)/settings/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** A settings section's form: server action, saved/error feedback, one submit button. */
export function SettingsForm({
  action,
  submitLabel,
  savedLabel,
  children,
  className,
}: {
  action: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
  submitLabel: string;
  savedLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  return (
    <form action={formAction} className={className ?? 'flex flex-col gap-4'}>
      {children}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={savedLabel} /> : null}
        {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
