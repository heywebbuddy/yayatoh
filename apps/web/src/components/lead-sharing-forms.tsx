'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * One-button forms of the attendee's "who scanned me" (M5.6b): stop sharing the email with one
 * exhibitor, or turn sharing on or off for future scans. 44 px targets (a phone-first page);
 * the outcome is announced next to the button.
 */
export function LeadSharingButton({
  action,
  label,
  done,
}: {
  action: (prev: FormState) => Promise<FormState>;
  label: string;
  done: string;
}) {
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="lg" variant="secondary" disabled={pending}>
        {label}
      </Button>
      <span aria-live="polite" className="text-caption">
        {state.ok ? done : state.code ? te(errorMessageKey(state.code)) : null}
      </span>
    </form>
  );
}
