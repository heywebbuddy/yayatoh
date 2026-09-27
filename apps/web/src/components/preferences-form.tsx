'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { PreferencesState } from '@/app/[locale]/o/[org]/(org)/notifications/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const CATEGORIES = ['sales', 'messages', 'marketing'] as const;
const CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;

/**
 * One fieldset per category with a checkbox per channel (native inputs: keyboard and screen
 * readers for free). Saving posts the whole grid; the result is announced.
 */
export function PreferencesForm({
  action,
  grid,
}: {
  action: (prev: PreferencesState, form: FormData) => Promise<PreferencesState>;
  grid: readonly { category: string; channel: string; enabled: boolean }[];
}) {
  const t = useTranslations('notifications');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { saved: false, tested: false, code: null });
  const on = new Set(grid.filter((g) => g.enabled).map((g) => `${g.category}:${g.channel}`));
  return (
    <form action={formAction} className="flex flex-col gap-5">
      {CATEGORIES.map((c) => (
        <fieldset key={c} className="flex flex-col gap-2 border-b border-zinc-100 pb-4">
          <legend className="text-section">{t(`preferences.categories.${c}.name`)}</legend>
          <p className="text-caption text-zinc-500">{t(`preferences.categories.${c}.hint`)}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {CHANNELS.map((ch) => (
              <label key={ch} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="checkbox"
                  name={`${c}:${ch}`}
                  defaultChecked={on.has(`${c}:${ch}`)}
                  className="size-5 accent-zinc-900"
                />
                {t(`channels.${ch}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="text-caption text-zinc-500">{t('preferences.required')}</p>
      <div role="status" aria-live="polite">
        {state.saved ? <p className="text-body font-medium">{t('preferences.saved')}</p> : null}
        {state.tested ? <p className="text-body font-medium">{t('preferences.testSent')}</p> : null}
      </div>
      {state.code ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {t('preferences.save')}
        </Button>
        <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
          {t('preferences.test')}
        </Button>
      </div>
    </form>
  );
}
