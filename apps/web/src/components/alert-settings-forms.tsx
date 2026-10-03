'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SettingsFormState } from '@/app/[locale]/o/[org]/(org)/alerts/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Act = (prev: SettingsFormState, form: FormData) => Promise<SettingsFormState>;

function Outcome({ state, fieldError }: { state: SettingsFormState; fieldError: boolean }) {
  const t = useTranslations('alerts.settings');
  const te = useTranslations();
  return (
    <div aria-live="polite">
      {state.kind === 'saved' ? (
        <Alert
          key={state.seq}
          tone="info"
          title={
            state.what === 'phone'
              ? t('phone.saved')
              : state.what === 'phoneCleared'
                ? t('phone.cleared')
                : state.what === 'routing'
                  ? t('routing.saved')
                  : state.what === 'target'
                    ? t('targets.saved')
                    : t('targets.cleared')
          }
        />
      ) : null}
      {state.kind === 'error' && !fieldError ? (
        <Alert
          key={state.seq}
          title={state.code === 'forbidden' ? te('alerts.errors.forbidden') : te(errorMessageKey(state.code))}
        />
      ) : null}
    </div>
  );
}

/** The member's own number for alert texts (M3.2b). */
export function AlertPhoneForm({ current, action }: { current: string | null; action: Act }) {
  const t = useTranslations('alerts.settings.phone');
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const invalid = state.kind === 'error' && state.field === 'smsPhone' && state.code === 'validation_failed';
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Input
        id="alert-phone"
        name="smsPhone"
        type="tel"
        autoComplete="tel"
        label={t('label')}
        hint={t('hint')}
        error={invalid ? t('invalid') : undefined}
        defaultValue={state.kind === 'error' ? state.value : (current ?? '')}
      />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('save')}
        </Button>
      </div>
      <Outcome state={state} fieldError={invalid} />
    </form>
  );
}

export interface RoutingRow {
  readonly role: string;
  readonly roleLabel: string;
  readonly cells: readonly {
    readonly category: string;
    readonly groupLabel: string;
    readonly channels: readonly { readonly channel: string; readonly label: string; readonly on: boolean }[];
  }[];
}

/** Who hears about which alerts: one fieldset per role, a row per group, a box per channel. */
export function AlertRoutingForm({
  rows,
  editable,
  action,
}: {
  rows: readonly RoutingRow[];
  editable: boolean;
  action: Act;
}) {
  const t = useTranslations('alerts.settings.routing');
  const tc = useTranslations('alerts');
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {rows.map((r) => (
        <fieldset
          key={r.role}
          className="flex flex-col gap-2 rounded-card border border-line p-4"
          data-role={r.role}
        >
          <legend className="px-1 text-[13px] font-bold text-ink">{r.roleLabel}</legend>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-body">
              <thead>
                <tr>
                  <th scope="col" className="py-1 pe-3 text-start text-caption font-normal text-ink-2">
                    {t('group')}
                  </th>
                  {r.cells[0]?.channels.map((c) => (
                    <th key={c.channel} scope="col" className="px-2 py-1 text-caption font-normal text-ink-2">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.cells.map((cell) => (
                  <tr key={cell.category} className="border-t border-line">
                    <th scope="row" className="py-1 pe-3 text-start font-normal">
                      {cell.groupLabel}
                    </th>
                    {cell.channels.map((c) => (
                      <td key={c.channel} className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          name="cell"
                          value={`${r.role}:${cell.category}:${c.channel}`}
                          defaultChecked={c.on}
                          disabled={!editable}
                          aria-label={tc('settings.routing.cell', {
                            channel: c.label,
                            group: cell.groupLabel,
                            role: r.roleLabel,
                          })}
                          className="size-6 accent-primary"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      ))}
      {editable ? (
        <div>
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
        </div>
      ) : (
        <p className="text-caption text-ink-2">{t('readOnly')}</p>
      )}
      <Outcome state={state} fieldError={false} />
    </form>
  );
}

/** One upcoming event's ticket target. */
export function SalesTargetForm({
  eventId,
  eventName,
  current,
  action,
}: {
  eventId: string;
  eventName: string;
  current: number | null;
  action: Act;
}) {
  const t = useTranslations('alerts.settings.targets');
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const invalid = state.kind === 'error' && state.field === 'tickets' && state.code === 'validation_failed';
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" noValidate data-event={eventId}>
      <div className="min-w-48 flex-1">
        <Input
          id={`target-${eventId}`}
          name="tickets"
          inputMode="numeric"
          label={t('label', { event: eventName })}
          error={invalid ? t('invalid') : undefined}
          defaultValue={state.kind === 'error' ? state.value : current === null ? '' : String(current)}
        />
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={t('saveFor', { event: eventName })}
      >
        {t('save')}
      </Button>
      <div className="basis-full">
        <Outcome state={state} fieldError={invalid} />
      </div>
    </form>
  );
}
