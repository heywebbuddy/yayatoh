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
        <label htmlFor="checkpoint-kind" className="text-caption text-zinc-600">
          {t('checkpoints.kind')}
        </label>
        <select
          id="checkpoint-kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value === 'zone' ? 'zone' : 'entrance')}
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          <option value="entrance">{t('checkpoints.entrance')}</option>
          <option value="zone">{t('checkpoints.zone')}</option>
        </select>
      </div>
      {kind === 'zone' ? (
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-caption text-zinc-600">{t('checkpoints.types')}</legend>
          <p className="text-caption text-zinc-500">{t('checkpoints.typesHint')}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {ticketTypes.map((tt) => (
              <label key={tt.id} className="flex min-h-6 items-center gap-2 text-body">
                <input type="checkbox" name="ticketTypeIds" value={tt.id} className="size-5 accent-ink" />
                {tt.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('checkpoints.added')} /> : null}
          {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('checkpoints.add')}
        </Button>
      </div>
    </form>
  );
}
