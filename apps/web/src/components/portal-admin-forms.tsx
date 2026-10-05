'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import type { RemindState } from '@/app/[locale]/o/[org]/e/[event]/speakers/portal-actions.ts';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';

function Outcome({
  state,
  pending,
  successLabel,
  errors,
}: {
  state: ProgramFormState;
  pending: boolean;
  successLabel: string;
  errors: Readonly<Record<string, string>>;
}) {
  const t = useTranslations();
  return (
    <div aria-live="polite">
      {state.ok && !pending ? <Alert tone="info" title={successLabel} /> : null}
      {state.code ? (
        <Alert
          title={
            (state.reason && errors[state.reason]) || errors[state.code] || t(errorMessageKey(state.code))
          }
        />
      ) : null}
    </div>
  );
}

/** One button that runs an organizer action and announces its outcome (revoke, delete, assign). */
export function ActionButtonForm({
  action,
  label,
  successLabel,
  errors = {},
  variant = 'secondary',
}: {
  action: (prev: ProgramFormState) => Promise<ProgramFormState>;
  label: string;
  successLabel: string;
  errors?: Readonly<Record<string, string>>;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as ProgramFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div>
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {label}
        </Button>
      </div>
      <Outcome state={state} pending={pending} successLabel={successLabel} errors={errors} />
    </form>
  );
}

/** "Remind N missing": the result says how many were emailed and how many have no access. */
export function RemindForm({
  action,
  label,
  disabled,
}: {
  action: (prev: RemindState) => Promise<RemindState>;
  label: string;
  disabled: boolean;
}) {
  const t = useTranslations('speakerTasks');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as RemindState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div>
        <Button type="submit" size="sm" disabled={pending || disabled}>
          {label}
        </Button>
      </div>
      <Outcome
        state={state}
        pending={pending}
        successLabel={
          state.recipients === 0
            ? t('remindedNone')
            : `${t('reminded', { count: state.recipients ?? 0 })}${
                state.unreachable ? ` ${t('unreachable', { count: state.unreachable })}` : ''
              }`
        }
        errors={{}}
      />
    </form>
  );
}

/** Approve or reject a proposed change, with an optional note to the speaker. */
export function DecideForm({
  action,
  approveLabel,
  rejectLabel,
  noteLabel,
  successLabel,
  errors,
}: {
  action: (prev: ProgramFormState, form: FormData) => Promise<ProgramFormState>;
  approveLabel: string;
  rejectLabel: string;
  noteLabel: string;
  successLabel: string;
  errors: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as ProgramFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-[13px] font-bold text-ink">
          {noteLabel}
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          maxLength={500}
          className="field w-full py-3 leading-relaxed"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
          {approveLabel}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" size="sm" disabled={pending}>
          {rejectLabel}
        </Button>
      </div>
      <Outcome state={state} pending={pending} successLabel={successLabel} errors={errors} />
    </form>
  );
}
