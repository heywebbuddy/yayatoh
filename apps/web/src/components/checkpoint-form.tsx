'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { CheckpointFormState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Add an entrance (admits to the event) or a zone (checks the pass includes it). */
export function CheckpointForm({
  ticketTypes,
  action,
}: {
  ticketTypes: readonly { id: string; name: string }[];
  action: (prev: CheckpointFormState, form: FormData) => Promise<CheckpointFormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [kind, setKind] = useState<'entrance' | 'zone'>('entrance');
  const ref = useRef<HTMLFormElement>(null);
  const locationError = state.field === 'location' ? t('checkpoints.locationError') : undefined;
  const capacityError = state.field === 'capacity' ? t('checkpoints.capacityError') : undefined;
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setKind('entrance');
    }
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input
        name="name"
        required
        maxLength={60}
        label={t('checkpoints.name')}
        hint={t('checkpoints.nameHint')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkpoint-kind" className="text-[13px] font-bold text-ink">
          {t('checkpoints.kind')}
        </label>
        <select
          id="checkpoint-kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value === 'zone' ? 'zone' : 'entrance')}
          className="field"
        >
          <option value="entrance">{t('checkpoints.entrance')}</option>
          <option value="zone">{t('checkpoints.zone')}</option>
        </select>
      </div>
      {kind === 'zone' ? (
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-[13px] font-bold text-ink">{t('checkpoints.types')}</legend>
          <p className="text-caption text-ink-2">{t('checkpoints.typesHint')}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {ticketTypes.map((tt) => (
              <label key={tt.id} className="flex min-h-6 items-center gap-2 text-body">
                <input type="checkbox" name="ticketTypeIds" value={tt.id} className="size-5 accent-primary" />
                {tt.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Input
        name="capacity"
        inputMode="numeric"
        label={t('checkpoints.capacity')}
        hint={t('checkpoints.capacityHint')}
        error={capacityError}
      />
      <fieldset className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
        <legend className="text-[13px] font-bold text-ink">{t('checkpoints.location')}</legend>
        <p className="text-caption text-ink-2 md:col-span-2">{t('checkpoints.locationHint')}</p>
        <Input name="latitude" inputMode="decimal" label={t('checkpoints.latitude')} error={locationError} />
        <Input
          name="longitude"
          inputMode="decimal"
          label={t('checkpoints.longitude')}
          error={locationError}
        />
      </fieldset>
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('checkpoints.added')} /> : null}
          {state.code && state.field !== 'location' && state.field !== 'capacity' ? (
            <Alert title={t(errorMessageKey(state.code))} />
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('checkpoints.add')}
        </Button>
      </div>
    </form>
  );
}
