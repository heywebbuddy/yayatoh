'use client';

import { Alert } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormHTMLAttributes, type ReactNode, useCallback } from 'react';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import type { PeopleActionState } from './actions.ts';

/**
 * A form for the people and duplicates actions (M6.1a): redirects on success; otherwise the
 * answer's code becomes a message (`messages[code]`, else the shared error text). Step-up opens
 * the confirm dialog and resends (bulk merges).
 */
export function PeopleActionForm({
  action,
  messages,
  children,
  ...props
}: {
  action: (prev: PeopleActionState, form: FormData) => Promise<PeopleActionState>;
  messages: Readonly<Record<string, string>>;
  children: ReactNode;
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'children'>) {
  const t = useTranslations();
  const run = useCallback(async (prev: PeopleActionState, form: FormData) => action(prev, form), [action]);
  const [state, formAction, pending, formRef] = useStepUpActionState<PeopleActionState>(run, { code: null });
  const code = state.code;
  const message = code ? (messages[code] ?? t(errorMessageKey(code.split(':')[0]))) : null;
  return (
    <form ref={formRef} action={formAction} aria-busy={pending || undefined} {...props}>
      {children}
      <div aria-live="polite" className="basis-full">
        {message ? <Alert title={message} /> : null}
      </div>
    </form>
  );
}
