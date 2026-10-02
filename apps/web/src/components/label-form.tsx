'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { LabelState } from '@/app/[locale]/o/[org]/e/[event]/attendees/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Add one label to an attendee (Enter or the button). */
export function LabelForm({
  action,
  suggestions,
}: {
  action: (prev: LabelState, form: FormData) => Promise<LabelState>;
  /** Labels already used at this event, offered as completions. */
  suggestions: readonly string[];
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="attendee-label" className="text-[13px] font-bold text-ink">
            {t('labels.add')}
          </label>
          <input
            id="attendee-label"
            name="label"
            required
            maxLength={40}
            list="attendee-label-suggestions"
            autoComplete="off"
            className="field"
          />
          <datalist id="attendee-label-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('labels.addButton')}
        </Button>
      </div>
      <div aria-live="polite">{state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}</div>
    </form>
  );
}
