'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { DisplayLinkState } from '@/app/[locale]/o/[org]/e/[event]/command-center/tv/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Create a TV display link (M3.3a); the link is shown once, to open on the venue screen. */
export function DisplayLinkForm({
  action,
}: {
  action: (prev: DisplayLinkState, form: FormData) => Promise<DisplayLinkState>;
}) {
  const t = useTranslations('commandCenter.tv');
  const te = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.kind === 'created') ref.current?.reset();
  }, [state]);
  const url = (token: string) =>
    `${window.location.origin}${locale === 'en' ? '' : `/${locale}`}/tv/${encodeURIComponent(token)}`;
  return (
    <Card className="flex flex-col gap-3">
      <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="min-w-0 flex-1">
          <Input
            name="label"
            required
            maxLength={60}
            label={t('label')}
            hint={t('labelHint')}
            error={state.kind === 'error' && state.field === 'label' ? t('labelError') : undefined}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t('create')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'created' ? (
          <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-4">
            <p className="text-body">{t('createdOnce', { label: state.label })}</p>
            <a href={url(state.token)} className="break-all text-caption underline" data-testid="tv-link">
              {url(state.token)}
            </a>
          </div>
        ) : state.kind === 'error' && state.field !== 'label' ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
