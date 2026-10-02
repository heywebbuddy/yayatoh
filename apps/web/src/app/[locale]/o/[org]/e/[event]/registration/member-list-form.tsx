'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * A type's member list (M5.1c): a CSV file or pasted addresses (any column; one list replaces the
 * last). Applicants on it are approved on applying.
 */
export function MemberListForm({
  action,
  idPrefix,
  typeName,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  idPrefix: string;
  typeName: string;
}) {
  const t = useTranslations('registration.rules');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = state.fields?.includes('members') || state.fields?.includes('emails');
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      aria-label={t('membersFor', { name: typeName })}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-file`} className="text-caption text-ink-2">
          {t('membersFile')}
        </label>
        <input
          id={`${idPrefix}-file`}
          name="file"
          type="file"
          accept=".csv,text/csv,text/plain"
          className="min-h-10 text-body"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-members`} className="text-caption text-ink-2">
          {t('membersPaste')}
        </label>
        <textarea
          id={`${idPrefix}-members`}
          name="members"
          rows={4}
          aria-invalid={bad ? true : undefined}
          aria-describedby={`${idPrefix}-members-hint`}
          className={`rounded-card border bg-surface px-4 py-2 text-body ${bad ? 'border-danger' : 'border-line'}`}
        />
        <p id={`${idPrefix}-members-hint`} className="text-caption text-ink-2">
          {t('membersHint')}
        </p>
      </div>
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="info" title={t('membersSaved')} /> : null}
        {state.code ? (
          <Alert
            title={
              state.reason === 'too_many_members'
                ? t('errors.tooManyMembers')
                : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('membersSave', { name: typeName })}
      </Button>
    </form>
  );
}
