'use client';

import { BRAND_KIT_NAME_MAX, BRAND_VOICE_MAX, TONES, type Tone } from '@yayatoh/ai/ui';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

interface Kit {
  readonly name: string;
  readonly voice: string;
  readonly tone: Tone;
  readonly keywords: readonly string[];
  readonly avoid: readonly string[];
  readonly isDefault: boolean;
}

/** M6.12b: create or edit a brand kit (and delete an existing one). Inline errors per field. */
export function BrandKitForm({
  idPrefix,
  kit,
  save,
  remove,
}: {
  idPrefix: string;
  kit: Kit | null;
  save: (prev: FormState, form: FormData) => Promise<FormState>;
  remove?: (prev: FormState) => Promise<FormState>;
}) {
  const t = useTranslations('brandKits');
  const ta = useTranslations('aiCompose');
  const te = useTranslations();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  const [delState, delAction, deleting] = useActionState(
    remove ?? (async () => INITIAL_FORM_STATE),
    INITIAL_FORM_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bad = (f: string) => state.fields?.includes(f) ?? false;
  const nameError =
    state.code === 'conflict' ? t('errors.nameTaken') : bad('name') ? t('errors.name') : undefined;
  const termsError = (f: 'keywords' | 'avoid') => (bad(f) ? t('errors.terms') : undefined);
  const id = (f: string) => `${idPrefix}-${f}`;

  useEffect(() => {
    if (state.ok && !kit) formRef.current?.reset();
  }, [state, kit]);
  useEffect(() => {
    if (!state.ok && state.fields?.length) document.getElementById(id(state.fields[0] ?? 'name'))?.focus();
  });

  const other =
    !state.ok && state.code && state.code !== 'validation_failed' && state.code !== 'conflict'
      ? te(errorMessageKey(state.code))
      : null;

  return (
    <div className="flex flex-col gap-3 pt-3">
      <form ref={formRef} onSubmit={keepValues(action)} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id={id('name')}
            name="name"
            label={t('name')}
            defaultValue={kit?.name ?? ''}
            maxLength={BRAND_KIT_NAME_MAX}
            required
            error={nameError}
          />
          <Select
            id={id('tone')}
            name="tone"
            label={t('tone')}
            defaultValue={kit?.tone ?? 'friendly'}
            options={TONES.map((k) => ({ value: k, label: ta(`tones.${k}`), text: ta(`tones.${k}`) }))}
          />
        </div>
        <Textarea
          id={id('voice')}
          name="voice"
          label={t('voice')}
          hint={t('voiceHint')}
          rows={3}
          maxLength={BRAND_VOICE_MAX}
          defaultValue={kit?.voice ?? ''}
          error={bad('voice') ? t('errors.voice') : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id={id('keywords')}
            name="keywords"
            label={t('keywords')}
            hint={termsError('keywords') ? undefined : t('termsHint')}
            defaultValue={kit?.keywords.join(', ') ?? ''}
            error={termsError('keywords')}
          />
          <Input
            id={id('avoid')}
            name="avoid"
            label={t('avoid')}
            hint={termsError('avoid') ? undefined : t('termsHint')}
            defaultValue={kit?.avoid.join(', ') ?? ''}
            error={termsError('avoid')}
          />
        </div>
        <Checkbox
          id={id('default')}
          name="isDefault"
          defaultChecked={kit?.isDefault ?? false}
          label={t('makeDefault')}
        />
        <div role="status" aria-live="polite">
          {state.ok ? <p className="text-body font-medium">{kit ? t('saved') : t('created')}</p> : null}
        </div>
        {other ? <Alert title={other} /> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>
            {kit ? t('save') : t('create')}
          </Button>
        </div>
      </form>
      {remove && kit ? (
        <form action={delAction}>
          <Button
            type="submit"
            variant="danger"
            disabled={deleting}
            aria-label={t('deleteNamed', { name: kit.name })}
          >
            {t('delete')}
          </Button>
          {!delState.ok && delState.code ? <Alert title={te(errorMessageKey(delState.code))} /> : null}
        </form>
      ) : null}
    </div>
  );
}
