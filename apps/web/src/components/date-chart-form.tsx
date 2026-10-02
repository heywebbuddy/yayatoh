'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { SeatingState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

/** Refusals with their own words (anything else gets the general message for its code). */
const REASONS = new Set(['seats_in_use', 'layout_locked', 'date_has_chart', 'date_cancelled']);

/**
 * Give a date its own chart, or send it back to the event plan (M1.7g). The server refuses what
 * the locking rules forbid, and says why.
 */
export function DateChartForm({
  action,
  op,
}: {
  action: (prev: SeatingState, form: FormData) => Promise<SeatingState>;
  op: 'give' | 'remove';
}) {
  const t = useTranslations('seatingDates');
  const tr = useTranslations();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, { ok: false, code: null });
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="op" value={op} />
      <p className="text-caption text-ink-2">{t(op === 'remove' ? 'removeHint' : 'giveHint')}</p>
      <div aria-live="polite">
        {state.code ? (
          <Alert
            title={
              state.reason && REASONS.has(state.reason)
                ? t(`errors.${state.reason}`)
                : tr(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button
        type="submit"
        variant={op === 'remove' ? 'secondary' : 'primary'}
        disabled={pending}
        className="self-start"
      >
        {t(op === 'remove' ? 'remove' : 'give')}
      </Button>
    </form>
  );
}
