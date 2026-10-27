'use client';

import { useTranslations } from 'next-intl';
import type { SettingsState } from '@/app/[locale]/o/[org]/(org)/settings/actions.ts';
import { SettingsForm } from './settings-form.tsx';

type Action = (prev: SettingsState, form: FormData) => Promise<SettingsState>;

const label = 'text-[13px] font-bold text-ink';

/** The three fields of a pickup point: where, the address and how early passengers should be there. */
function PointFields({
  idPrefix,
  initial,
}: {
  idPrefix: string;
  initial?: { name: string; address: string; minutesBefore: number };
}) {
  const t = useTranslations('tourPickups');
  return (
    <div className="grid gap-3 md:grid-cols-[1.2fr_2fr_0.8fr]">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-name`} className={label}>
          {t('name')}
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name ?? ''}
          className="field w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-address`} className={label}>
          {t('address')}
        </label>
        <input
          id={`${idPrefix}-address`}
          name="address"
          maxLength={200}
          defaultValue={initial?.address ?? ''}
          className="field w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-min`} className={label}>
          {t('minutesBefore')}
        </label>
        <input
          id={`${idPrefix}-min`}
          name="minutesBefore"
          type="number"
          inputMode="numeric"
          min={0}
          max={720}
          defaultValue={initial?.minutesBefore ?? 15}
          className="field w-full"
        />
      </div>
    </div>
  );
}

export function AddPickupForm({ action }: { action: Action }) {
  const t = useTranslations('tourPickups');
  return (
    <SettingsForm action={action} submitLabel={t('add')} savedLabel={t('saved')}>
      <PointFields idPrefix="new-pickup" />
    </SettingsForm>
  );
}

export function EditPickupForm({
  id,
  save,
  remove,
  initial,
}: {
  id: string;
  save: Action;
  remove: Action;
  initial: { name: string; address: string; minutesBefore: number };
}) {
  const t = useTranslations('tourPickups');
  return (
    <div className="flex flex-col gap-3">
      <SettingsForm action={save} submitLabel={t('save')} savedLabel={t('saved')}>
        <PointFields idPrefix={`pickup-${id}`} initial={initial} />
      </SettingsForm>
      <SettingsForm action={remove} submitLabel={t('remove')} savedLabel={t('removed')}>
        <span className="sr-only">{initial.name}</span>
      </SettingsForm>
    </div>
  );
}
