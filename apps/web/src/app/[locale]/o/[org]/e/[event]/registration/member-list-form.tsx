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
      className="flex flex-col gap-3 border-t border-line pt-4"
      aria-label={t('membersFor', { name: typeName })}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-file`} className="text-[13px] font-bold text-ink">
          {t('membersFile')}
        </label>
        <input
          id={`${idPrefix}-file`}
          name="file"
          type="file"
          accept=".csv,text/csv,text/plain"
          className="min-h-11 text-body text-ink-2 file:me-3 file:min-h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:font-bold file:text-ink hover:file:bg-surface-2"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-members`} className="text-[13px] font-bold text-ink">
          {t('membersPaste')}
        </label>
        <textarea
          id={`${idPrefix}-members`}
          name="members"
          rows={4}
          aria-invalid={bad ? true : undefined}
          aria-describedby={`${idPrefix}-members-hint`}
          className="field w-full py-3 leading-relaxed"
        />
        <p id={`${idPrefix}-members-hint`} className="text-caption text-ink-2">
          {t('membersHint')}
        </p>
      </div>
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="success" title={t('membersSaved')} /> : null}
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
