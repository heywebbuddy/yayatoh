'use client';

import { Alert, Button, Switch, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** U10: the contact page block's settings (on/off and its line of text), with inline feedback. */
export function ContactPageSettings({
  action,
  enabled,
  intro,
  canWrite,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  enabled: boolean;
  intro: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations('orgContactConsole');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [on, setOn] = useState(enabled);
  const bad = new Set(state.fields ?? []);
  return (
    <form action={formAction} noValidate aria-label={t('settingsLabel')} className="flex flex-col gap-4">
      <Switch
        id="contact-enabled"
        name="enabled"
        checked={on}
        onChange={(e) => setOn(e.currentTarget.checked)}
        disabled={!canWrite}
        label={t('enabled')}
        hint={t('enabledHint')}
      />
      <Textarea
        id="contact-intro"
        name="intro"
        rows={3}
        maxLength={500}
        defaultValue={intro ?? ''}
        disabled={!canWrite}
        label={t('intro')}
        hint={t('introHint')}
        error={bad.has('intro') ? t('introError') : undefined}
      />
      <div aria-live="polite">
        {state.ok ? (
          <Alert tone="success" title={on ? t('savedOn') : t('savedOff')} />
        ) : state.code ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      {canWrite ? (
        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      ) : null}
    </form>
  );
}

/** "Mark handled" for one message. */
export function MarkHandledButton({
  action,
  name,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  name: string;
}) {
  const t = useTranslations('orgContactConsole');
  const [, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction}>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={pending}
        aria-label={t('markHandledFor', { name })}
      >
        {t('markHandled')}
      </Button>
    </form>
  );
}
