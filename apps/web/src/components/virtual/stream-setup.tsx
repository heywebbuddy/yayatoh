'use client';

import { Alert, Button, Radio, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useId, useState } from 'react';
import type { StreamKeyState, SwitchState } from '@/app/[locale]/o/[org]/e/[event]/virtual/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Save = (prev: FormState, form: FormData) => Promise<FormState>;
type Act = (prev: FormState) => Promise<FormState>;

const DELIVERY = ['in_person', 'online', 'hybrid'] as const;
/** Refusal reasons with their own message (`virtual.errors.*`); others use the generic code's. */
export const VIRTUAL_REASONS = [
  'in_person_event',
  'video_off',
  'in_person_only',
  'stream_off',
  'provider_changed',
  'views_per_hour',
  'invalid_token',
  'ticket_void',
  // M6.10a
  'provider_unavailable',
  'no_backup_ingest',
  'zoom_not_connected',
  'zoom_failed',
  'integrations_off',
  'webinar_taken',
] as const;
const known = (r: string | undefined): r is (typeof VIRTUAL_REASONS)[number] =>
  !!r && (VIRTUAL_REASONS as readonly string[]).includes(r);
const ACCESS = ['in_person', 'virtual', 'both'] as const;

export function Outcome({ state, saved }: { state: FormState; saved: string }) {
  const te = useTranslations();
  return (
    <div aria-live="polite">
      {state.ok ? <Alert tone="success" title={saved} /> : null}
      {state.code ? (
        <Alert
          title={te(known(state.reason) ? `virtual.errors.${state.reason}` : errorMessageKey(state.code))}
        />
      ) : null}
    </div>
  );
}

/** How the event is delivered: in person, online or hybrid (the event's attendance mode). */
export function DeliveryForm({ value, canEdit, save }: { value: string; canEdit: boolean; save: Save }) {
  const t = useTranslations('virtual.setup');
  const id = useId();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <fieldset className="flex flex-col" disabled={!canEdit}>
        <legend className="text-body font-semibold">{t('deliveryLegend')}</legend>
        {DELIVERY.map((d) => (
          <Radio
            key={`${d}-${value}`}
            id={`${id}-${d}`}
            name="delivery"
            value={d}
            defaultChecked={value === d}
            label={t(`delivery.${d}`)}
            hint={t(`deliveryHint.${d}`)}
          />
        ))}
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {t('saveDelivery')}
          </Button>
        </div>
      ) : null}
      <Outcome state={state} saved={t('deliverySaved')} />
    </form>
  );
}

/** One ticket type's access mode. */
export function AccessForm({
  name,
  value,
  effective,
  canEdit,
  save,
}: {
  name: string;
  value: string | null;
  effective: string;
  canEdit: boolean;
  save: Save;
}) {
  const t = useTranslations('virtual.setup');
  const id = useId();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  const current = value ?? effective;
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <fieldset className="flex flex-col" disabled={!canEdit}>
        <legend className="text-body font-semibold">{name}</legend>
        {value === null ? <p className="m-0 text-caption text-ink-2">{t('defaultNote')}</p> : null}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-6">
          {ACCESS.map((a) => (
            <Radio
              key={`${a}-${current}`}
              id={`${id}-${a}`}
              name="access"
              value={a}
              defaultChecked={current === a}
              label={t(`access.${a}`)}
            />
          ))}
        </div>
      </fieldset>
      {canEdit ? (
        <div>
          <Button
            type="submit"
            variant="secondary"
            disabled={pending}
            aria-label={t('saveAccessLabel', { name })}
          >
            {t('saveAccess')}
          </Button>
        </div>
      ) : null}
      <Outcome state={state} saved={t('accessSaved', { name })} />
    </form>
  );
}

/** M6.10a: a provider a session may use (its translated label comes from `virtual.setup.providerName`). */
export interface ProviderOption {
  readonly name: string;
}

/**
 * A session's stream: set it up (at the chosen provider), switch it off and on, move it to another
 * provider (M6.10a), switch the encoder to the backup ingest (M6.10a RTMP overflow), show the
 * encoder's key.
 */
export function StreamControls({
  title,
  hasStream,
  enabled,
  canEdit,
  canStream,
  providers,
  provider,
  hasBackup,
  activeIngest,
  create,
  toggle,
  reveal,
  switchProvider,
  setIngest,
}: {
  title: string;
  hasStream: boolean;
  enabled: boolean;
  canEdit: boolean;
  /** False on an in-person event or without a video provider. */
  canStream: boolean;
  /** Every provider a session may use (the default first). */
  providers: readonly ProviderOption[];
  /** The stream's provider, or null without a stream. */
  provider: string | null;
  hasBackup: boolean;
  activeIngest: 'primary' | 'backup';
  create: Save;
  toggle: Act;
  reveal: (prev: StreamKeyState) => Promise<StreamKeyState>;
  switchProvider: (prev: SwitchState, form: FormData) => Promise<SwitchState>;
  setIngest: Act;
}) {
  const t = useTranslations('virtual.setup');
  const id = useId();
  const [chosen, setChosen] = useState(provider ?? providers[0]?.name ?? '');
  const [created, createAction, creating] = useActionState(create, INITIAL_FORM_STATE);
  const [toggled, toggleAction, toggling] = useActionState(toggle, INITIAL_FORM_STATE);
  const [key, revealAction, revealing] = useActionState(reveal, INITIAL_FORM_STATE as StreamKeyState);
  const [moved, moveAction, moving] = useActionState(switchProvider, INITIAL_FORM_STATE as SwitchState);
  const [ingested, ingestAction, ingesting] = useActionState(setIngest, INITIAL_FORM_STATE);
  if (!canEdit) return null;
  const label = (name: string) => t(`providerName.${name}` as 'providerName.fake');
  const choose = providers.length > 1;
  return (
    <div className="flex flex-col gap-2">
      {!hasStream ? (
        <form action={createAction} className="flex flex-col gap-2" noValidate>
          {choose ? (
            <Select
              id={`${id}-new-provider`}
              name="provider"
              label={t('provider')}
              aria-label={t('providerFor', { title })}
              fieldSize="sm"
              value={chosen}
              onValueChange={setChosen}
              disabled={!canStream}
              options={providers.map((p) => ({ value: p.name, label: label(p.name), text: label(p.name) }))}
            />
          ) : null}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={creating || !canStream}
              aria-label={t('createStreamLabel', { title })}
            >
              {t('createStream')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={revealing}
              aria-label={t('showKeyLabel', { title })}
              aria-controls={`${id}-key`}
              onClick={() => startTransition(() => revealAction())}
            >
              {t('showKey')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={toggling}
              aria-label={t(enabled ? 'turnOffLabel' : 'turnOnLabel', { title })}
              onClick={() => startTransition(() => toggleAction())}
            >
              {t(enabled ? 'turnOff' : 'turnOn')}
            </Button>
            {hasBackup ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={ingesting}
                aria-label={t(activeIngest === 'backup' ? 'usePrimaryLabel' : 'useBackupLabel', { title })}
                onClick={() => startTransition(() => ingestAction())}
              >
                {t(activeIngest === 'backup' ? 'usePrimary' : 'useBackup')}
              </Button>
            ) : null}
          </div>
          {choose ? (
            <form action={moveAction} className="flex flex-wrap items-end gap-2" noValidate>
              <Select
                id={`${id}-provider`}
                name="provider"
                label={t('provider')}
                aria-label={t('providerFor', { title })}
                fieldSize="sm"
                value={chosen}
                onValueChange={setChosen}
                options={providers.map((p) => ({ value: p.name, label: label(p.name), text: label(p.name) }))}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={moving || chosen === provider}
                aria-label={t('switchProviderLabel', { title })}
              >
                {t('switchProvider')}
              </Button>
            </form>
          ) : null}
        </>
      )}
      <div id={`${id}-key`} aria-live="polite">
        {key.streamKey ? (
          <dl className="m-0 flex flex-col gap-1 rounded-control border border-line bg-surface-2 p-3 text-caption">
            <dt className="font-semibold text-ink">
              {t(key.activeIngest === 'backup' ? 'backupIngestUrl' : 'ingestUrl')}
            </dt>
            <dd className="m-0 break-all font-mono text-ink" data-testid="ingest-url">
              {key.ingestUrl}
            </dd>
            <dt className="font-semibold text-ink">{t('streamKey')}</dt>
            <dd className="m-0 break-all font-mono text-ink" data-testid="stream-key">
              {key.streamKey}
            </dd>
            <dd className="m-0 text-ink-2">{t('keyWarning')}</dd>
          </dl>
        ) : null}
      </div>
      <Outcome state={created} saved={t('streamCreated', { title })} />
      <Outcome state={toggled} saved={t(enabled ? 'streamOnSaved' : 'streamOffSaved', { title })} />
      <Outcome
        state={moved}
        saved={
          moved.switched === false
            ? t('providerSame', { title, provider: label(provider ?? chosen) })
            : t('providerSwitched', { title, provider: label(provider ?? chosen) })
        }
      />
      <Outcome state={ingested} saved={t(activeIngest === 'backup' ? 'backupOn' : 'primaryOn', { title })} />
      {key.code ? <Outcome state={key} saved="" /> : null}
    </div>
  );
}
