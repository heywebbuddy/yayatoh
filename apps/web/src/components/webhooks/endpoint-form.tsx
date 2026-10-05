'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { EndpointFormState } from '@/app/[locale]/o/[org]/(org)/webhooks/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface EventTypeGroup {
  readonly group: string;
  readonly types: readonly string[];
}

/**
 * Add or edit a webhook endpoint (M6.3b): its https URL, a description, and which events it
 * receives (every type, or the ticked ones). The server owns validation; its answers show inline.
 */
export function EndpointForm({
  action,
  groups,
  initial,
}: {
  action: (prev: EndpointFormState, form: FormData) => Promise<EndpointFormState>;
  groups: readonly EventTypeGroup[];
  /** Editing: the endpoint as it is. Absent: a new endpoint. */
  initial?: { url: string; description: string; eventTypes: readonly string[]; enabled: boolean };
}) {
  const t = useTranslations('webhooks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as EndpointFormState);
  const [receive, setReceive] = useState<'all' | 'selected'>(
    initial && initial.eventTypes.length > 0 ? 'selected' : 'all',
  );
  const invalid = (f: 'url' | 'description' | 'eventTypes') =>
    state.kind === 'error' && state.fields.includes(f);
  const urlError = invalid('url')
    ? t(
        `urlProblem.${state.kind === 'error' && state.reason ? state.reason : 'malformed'}` as 'urlProblem.malformed',
      )
    : undefined;
  const editing = initial !== undefined;
  const prefix = editing ? 'edit' : 'new';
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{editing ? t('settingsTitle') : t('createTitle')}</h2>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <Input
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
          defaultValue={initial?.url}
          label={t('url')}
          hint={t('urlHint')}
          error={urlError}
        />
        <Input
          name="description"
          maxLength={200}
          autoComplete="off"
          defaultValue={initial?.description}
          label={t('description')}
          hint={t('descriptionHint')}
          error={invalid('description') ? t('descriptionTooLong') : undefined}
        />
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={invalid('eventTypes') ? `${prefix}-types-error` : undefined}
        >
          <legend className="text-caption text-ink-2">{t('receive')}</legend>
          {(['all', 'selected'] as const).map((r) => (
            <label key={r} className="flex min-h-10 items-center gap-2.5 text-body">
              <input
                type="radio"
                name="receive"
                value={r}
                checked={receive === r}
                onChange={() => setReceive(r)}
                className="size-4 accent-line"
              />
              <span>{r === 'all' ? t('receiveAll') : t('receiveSelected')}</span>
            </label>
          ))}
          <div className={receive === 'selected' ? 'flex flex-col gap-3 ps-6' : 'hidden'}>
            {groups.map((g) => (
              <fieldset key={g.group} className="flex flex-col gap-1">
                <legend className="text-caption font-medium text-ink-2">
                  {t(`groups.${g.group}` as 'groups.orders')}
                </legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {g.types.map((type) => (
                    <label key={type} className="flex min-h-10 items-center gap-2.5 text-body">
                      <input
                        type="checkbox"
                        name="eventType"
                        value={type}
                        defaultChecked={initial?.eventTypes.includes(type)}
                        disabled={receive !== 'selected'}
                        className="size-4 accent-line"
                      />
                      <code className="font-mono text-caption">{type}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {invalid('eventTypes') ? (
            <p id={`${prefix}-types-error`} className="text-caption text-danger">
              {t('typesRequired')}
            </p>
          ) : null}
        </fieldset>
        {editing ? (
          <label className="flex min-h-10 items-center gap-2.5 text-body">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={initial.enabled}
              aria-describedby={`${prefix}-enabled-hint`}
              className="size-4 accent-line"
            />
            <span className="flex flex-col">
              <span>{t('enabled')}</span>
              <span id={`${prefix}-enabled-hint`} className="text-caption text-ink-2">
                {t('enabledHint')}
              </span>
            </span>
          </label>
        ) : null}
        <div>
          <Button type="submit" disabled={pending}>
            {editing ? t('save') : t('create')}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.kind === 'saved' ? (
          <p role="status" className="text-body font-medium">
            {t('saved')}
          </p>
        ) : state.kind === 'error' && state.fields.length === 0 ? (
          <Alert
            title={
              state.reason === 'endpoint_limit'
                ? t('limit')
                : state.reason === 'webhooks_unavailable'
                  ? t('unavailableTitle')
                  : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </Card>
  );
}
