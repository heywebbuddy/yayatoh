'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SelfCheckinState } from '@/app/[locale]/session-checkin/[token]/actions.ts';

/** M5.6a: "I'm here" — the attendee types the code on their ticket or badge. */
export function SelfCheckinForm({
  action,
}: {
  action: (prev: SelfCheckinState, form: FormData) => Promise<SelfCheckinState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const done = state.kind === 'done' && (state.result === 'entered' || state.result === 'duplicate');
  if (done)
    return (
      <div role="status" aria-live="polite" data-result={state.result}>
        <Alert
          tone="success"
          title={t(state.result === 'entered' ? 'selfCheckin.entered' : 'selfCheckin.already')}
        >
          {t('selfCheckin.enjoy')}
        </Alert>
      </div>
    );
  const error =
    state.kind === 'error'
      ? state.code === 'code_required'
        ? t('selfCheckin.codeRequired')
        : state.code === 'rate_limited'
          ? t('selfCheckin.rateLimited', { minutes: state.minutes ?? 1 })
          : t('selfCheckin.goneDescription')
      : state.kind === 'done' && state.result === 'not_found'
        ? t('selfCheckin.notFound')
        : state.kind === 'done' && state.result === 'closed'
          ? t('selfCheckin.closedDescription')
          : undefined;
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <p className="text-body text-ink-2">{t('selfCheckin.intro')}</p>
      <Input
        name="code"
        required
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        fieldSize="lg"
        maxLength={400}
        label={t('selfCheckin.codeLabel')}
        hint={t('selfCheckin.codeHint')}
        error={error}
      />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {t('selfCheckin.submit')}
      </Button>
    </form>
  );
}
