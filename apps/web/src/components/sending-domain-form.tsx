'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { DomainFormState } from '@/app/[locale]/o/[org]/(org)/sending/actions.ts';

/** Add the org's email sending domain (M3.5b): one field, errors announced and tied to it. */
export function SendingDomainForm({
  action,
}: {
  action: (prev: DomainFormState, form: FormData) => Promise<DomainFormState>;
}) {
  const t = useTranslations('sendingSetup');
  const [state, formAction, pending] = useActionState(action, { error: null, value: '' });
  const message = state.error ? t(`errors.${state.error}`) : null;
  return (
    <form
      action={formAction}
      noValidate
      aria-label={t('addTitle')}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1.5">
        <label htmlFor="sending-domain" className="text-caption text-zinc-600">
          {t('domainLabel')}
        </label>
        <input
          id="sending-domain"
          name="domain"
          defaultValue={state.value}
          maxLength={253}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          aria-invalid={message ? true : undefined}
          aria-describedby={`sending-domain-hint${message ? ' sending-domain-error' : ''}`}
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 font-mono text-body"
        />
        <p id="sending-domain-hint" className="text-caption text-zinc-500">
          {t('domainHint')}
        </p>
        {message ? (
          <p id="sending-domain-error" role="alert" className="text-caption text-pink-700">
            {message}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="mb-6">
        {t('add')}
      </Button>
    </form>
  );
}
