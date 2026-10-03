'use client';

import { ACCOUNT_CATEGORIES, type AccountMap, type ProviderAccount } from '@yayatoh/integrations/client';
import { Alert, Button, Card, DatePicker, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { AccountMapState } from '../actions.ts';

/**
 * The chart-of-accounts mapping (M6.5d): one account of the org's books per line of the daily
 * summary journal, and the first day to post. The provider's accounts are the options; the server
 * checks them again (and the clearing rule) and owns the messages.
 */
export function AccountMapForm({
  accounts,
  current,
  startsOn,
  today,
  timeZone,
  action,
}: {
  accounts: readonly ProviderAccount[];
  current: AccountMap | null;
  startsOn: string;
  today: string;
  timeZone: string;
  action: (prev: AccountMapState, form: FormData) => Promise<AccountMapState>;
}) {
  const t = useTranslations('integrations.accounting');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as AccountMapState);
  // Controlled: a refused save keeps what was chosen.
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(ACCOUNT_CATEGORIES.map((c) => [c, current?.[c]?.id ?? ''])),
  );
  const [day, setDay] = useState(startsOn);
  const issue = (field: string) => {
    const i = state.status === 'error' ? state.issues?.find((x) => x.field === field) : undefined;
    if (!i) return undefined;
    const name = ACCOUNT_CATEGORIES.includes(field as (typeof ACCOUNT_CATEGORIES)[number])
      ? t(`categories.${field}.label`)
      : '';
    return t.has(`issue.${i.code}`)
      ? t(`issue.${i.code}`, { field: name })
      : t('issue.other', { field: name });
  };
  const label = (a: ProviderAccount) => (a.code ? `${a.code} · ${a.name}` : a.name);
  return (
    <Card className="flex flex-col gap-4">
      <div aria-live="polite" className="empty:hidden">
        {state.status === 'saved' ? (
          <Alert tone="success" title={t('saved', { version: state.version ?? 0 })} />
        ) : null}
        {state.status === 'error' ? (
          <Alert tone="danger" title={state.code === 'validation_failed' ? t('invalid') : t('saveFailed')} />
        ) : null}
      </div>
      <form action={formAction} noValidate aria-label={t('mapTitle')} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {ACCOUNT_CATEGORIES.map((category) => (
            <Select
              key={category}
              id={`account-${category}`}
              name={`account.${category}`}
              label={t(`categories.${category}.label`)}
              hint={t(`categories.${category}.hint`)}
              value={chosen[category] ?? ''}
              onValueChange={(v) => setChosen((all) => ({ ...all, [category]: v }))}
              error={issue(category)}
              required
            >
              <option value="">{t('chooseAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {label(a)}
                </option>
              ))}
            </Select>
          ))}
        </div>
        <DatePicker
          id="accounting-starts-on"
          name="startsOn"
          label={t('startsOn')}
          hint={t('startsOnHint')}
          value={day}
          onValueChange={setDay}
          max={today}
          timeZone={timeZone}
          error={issue('startsOn')}
          required
        />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
