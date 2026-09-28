'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const field = 'min-h-10 w-full rounded-card border border-zinc-200 bg-white px-4 py-2 text-body';

/** Resolve one reconciliation difference with a note saying why (M1.6e). */
export function ResolveItemForm({
  action,
  reference,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  reference: string;
}) {
  const t = useTranslations('finance');
  const te = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const invalid = state.fields?.includes('note') ?? false;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor={`${id}-note`} className="text-caption text-zinc-600">
        {t('resolveNote', { reference })}
      </label>
      <textarea
        id={`${id}-note`}
        name="note"
        rows={2}
        maxLength={500}
        required
        minLength={3}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={field}
      />
      <div aria-live="polite" id={`${id}-error`}>
        {state.code ? (
          <Alert
            title={
              invalid
                ? t('noteTooShort')
                : state.reason === 'already_resolved'
                  ? t('alreadyResolved')
                  : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('resolve')}
      </Button>
    </form>
  );
}
