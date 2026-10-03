'use client';

import { Alert, Button, Checkbox, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { ScreenFormState } from './actions.ts';

/**
 * The screen's settings (M4.8d): the campaign it follows and whether donors who asked for it are
 * thanked by name. One primary action; the answer is announced and the field to fix gets focus.
 */
export function ScreenForm({
  action,
  campaigns,
  campaignId,
  showNames,
  setUp,
}: {
  action: (prev: ScreenFormState, form: FormData) => Promise<ScreenFormState>;
  campaigns: { id: string; name: string; closed: boolean }[];
  campaignId: string | null;
  showNames: boolean;
  setUp: boolean;
}) {
  const t = useTranslations('donations.screenPage');
  const [state, formAction, pending] = useActionState(action, { ok: null, message: '', stamp: 0 });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.field) ref.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);
  return (
    <form
      ref={ref}
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
      aria-label={t('settingsTitle')}
    >
      <Select
        id="screen-campaign"
        name="campaignId"
        label={t('campaign')}
        hint={t('campaignHint')}
        defaultValue={campaignId ?? ''}
        error={state.field === 'campaignId' ? state.message : undefined}
        required
      >
        {setUp ? null : <option value="">{t('chooseCampaign')}</option>}
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.closed ? t('campaignClosed', { name: c.name }) : c.name}
          </option>
        ))}
      </Select>
      <Checkbox
        id="screen-show-names"
        name="showNames"
        defaultChecked={showNames}
        label={t('showNames')}
        hint={t('showNamesHint')}
      />
      <div aria-live="polite" data-testid="screen-form-answer">
        {state.ok && !pending ? <Alert key={state.stamp} tone="success" title={state.message} /> : null}
        {state.ok === false && !state.field && !pending ? (
          <Alert key={state.stamp} tone="danger" title={state.message} />
        ) : null}
      </div>
      <Button type="submit" className="self-start" disabled={pending} loading={pending}>
        {setUp ? t('save') : t('setUp')}
      </Button>
    </form>
  );
}
