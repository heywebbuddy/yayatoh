'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ApiKeyState } from '@/app/[locale]/o/[org]/(org)/api-keys/actions.ts';
import { scopeKey } from '@/lib/api-keys.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

export function ApiKeyForm({
  scopes,
  action,
}: {
  scopes: readonly string[];
  action: (prev: ApiKeyState, form: FormData) => Promise<ApiKeyState>;
}) {
  const t = useTranslations();
  // Creating a key is a step-up command (M1.2c): "Confirm it's you" opens and the form resubmits.
  const [state, formAction, pending, formRef] = useStepUpActionState(action, { kind: 'idle' } as ApiKeyState);
  const [copied, setCopied] = useState<string | null>(null);
  const invalid = (f: 'name' | 'scopes') => state.kind === 'error' && state.fields.includes(f);
  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{t('apiKeys.createTitle')}</h2>
      {/* Server validation owns the messages (the same rules as the API). */}
      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
        <Input
          name="name"
          maxLength={60}
          autoComplete="off"
          label={t('apiKeys.name')}
          hint={t('apiKeys.nameHint')}
          error={invalid('name') ? t('apiKeys.nameRequired') : undefined}
        />
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={invalid('scopes') ? 'scopes-error' : 'scopes-hint'}
          aria-invalid={invalid('scopes') ? true : undefined}
        >
          <legend className="text-[13px] font-bold text-ink">{t('apiKeys.scopes')}</legend>
          <p id="scopes-hint" className="text-caption text-ink-2">
            {t('apiKeys.scopesHint')}
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {scopes.map((s) => (
              <label key={s} className="flex min-h-10 items-center gap-2.5 text-body">
                <input type="checkbox" name="scope" value={s} className="size-4 accent-primary" />
                <span>
                  {t(scopeKey(s))} <code className="font-mono text-caption text-ink-2">{s}</code>
                </span>
              </label>
            ))}
          </div>
          {invalid('scopes') ? (
            <p id="scopes-error" className="text-caption text-danger">
              {state.kind === 'error' && state.reason === 'test_key_scope'
                ? t('apiKeys.testScopesInvalid')
                : t('apiKeys.scopesRequired')}
            </p>
          ) : null}
        </fieldset>
        {/* M6.3a: how long the key lives; 90 days unless the creator picks otherwise. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="api-key-expiry" className="text-caption text-ink-2">
            {t('apiKeys.expiry')}
          </label>
          <select
            id="api-key-expiry"
            name="expiresInDays"
            defaultValue="90"
            aria-describedby="api-key-expiry-hint"
            className="min-h-10 self-start rounded-pill border border-line bg-surface-solid px-4 text-body"
          >
            {(['30', '90', '365', 'never'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`apiKeys.expiryIn.${v}`)}
              </option>
            ))}
          </select>
          <p id="api-key-expiry-hint" className="text-caption text-ink-2">
            {t('apiKeys.expiryHint')}
          </p>
        </div>
        {/* M1.13d: a test key (`yy_test_…`) is read-only and never sees personal data. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-bold text-ink">{t('apiKeys.mode')}</legend>
          {(['live', 'test'] as const).map((m) => (
            <label key={m} className="flex min-h-10 items-start gap-2.5 text-body">
              <input
                type="radio"
                name="mode"
                value={m}
                defaultChecked={m === 'live'}
                aria-describedby={`mode-${m}-hint`}
                className="mt-1 size-4 accent-primary"
              />
              <span className="flex flex-col">
                <span>{t(m === 'live' ? 'apiKeys.modeLive' : 'apiKeys.modeTest')}</span>
                <span id={`mode-${m}-hint`} className="text-caption text-ink-2">
                  {t(m === 'live' ? 'apiKeys.modeLiveHint' : 'apiKeys.modeTestHint')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={pending}>
            {t('apiKeys.create')}
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === 'created' ? (
          <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-4">
            <p className="text-body font-medium">{t('apiKeys.created', { name: state.name })}</p>
            <p className="text-body">{t('apiKeys.shownOnce')}</p>
            {state.sandbox ? <p className="text-body">{t('apiKeys.createdTest')}</p> : null}
            <code
              data-testid="new-api-key"
              className="break-all rounded-card bg-surface px-3 py-2 font-mono text-caption"
            >
              {state.key}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => copy(state.key)}>
                {t('apiKeys.copy')}
              </Button>
              <span role="status" className="text-caption text-ink-2">
                {copied === state.key ? t('apiKeys.copied') : ''}
              </span>
            </div>
          </div>
        ) : state.kind === 'error' && state.fields.length === 0 ? (
          <Alert title={t(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
