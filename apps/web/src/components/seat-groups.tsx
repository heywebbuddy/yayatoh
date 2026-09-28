'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState } from 'react';
import type { GroupState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface SeatGroupView {
  readonly label: string;
  readonly seats: number;
  readonly seated: number;
  readonly unused: number;
  readonly items: readonly { kind: 'row' | 'table'; label: string }[];
}

type FormAction = (prev: GroupState, form: FormData) => Promise<GroupState>;
const INITIAL: GroupState = { ok: false, code: null };

/**
 * Group blocks (M1.8f): seats kept for a group of people who share a label (a company, a family).
 * Keep seats at a table or row, seat the group's members into them in one go (a bulk operation),
 * and give back the seats nobody used. Viewers see the groups only.
 */
export function SeatGroups({
  groups,
  items,
  labels,
  canWrite,
  allocate,
  release,
  seat,
}: {
  groups: readonly SeatGroupView[];
  items: readonly { id: string; kind: 'row' | 'table'; label: string; free: number; capacity: number }[];
  /** The event's attendee labels (suggested group names). */
  labels: readonly string[];
  canWrite: boolean;
  allocate: FormAction;
  release: FormAction;
  seat: FormAction;
}) {
  const t = useTranslations('seating');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(allocate, INITIAL);
  const [released, releaseAction, releasing] = useActionState(release, INITIAL);
  const [seated, seatAction, seating] = useActionState(seat, INITIAL);
  // One place for what the group buttons did (a released group may leave the list).
  const outcome =
    seating || releasing
      ? null
      : (seated.at ?? 0) > (released.at ?? 0)
        ? seated
        : released.at
          ? released
          : null;
  const itemName = (i: { kind: 'row' | 'table'; label: string }) =>
    t(`prices.item.${i.kind}`, { label: i.label });
  const cls = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
  const invalid = (f: GroupState['field']) => (state.field === f ? true : undefined);
  return (
    <section
      aria-labelledby="groups-heading"
      className="flex flex-col gap-3 rounded-panel border border-zinc-200 bg-white px-5 py-4"
    >
      <h2 id="groups-heading" className="text-section">
        {t('groups.title')}
      </h2>
      <p className="text-caption text-zinc-500">{t('groups.description')}</p>
      {groups.length === 0 ? (
        <p className="text-body text-zinc-600">{t('groups.empty')}</p>
      ) : (
        <ul aria-label={t('groups.list')} className="flex list-none flex-col gap-2 p-0">
          {groups.map((g) => (
            <li key={g.label} className="flex flex-col gap-2 rounded-card border border-zinc-200 px-4 py-3">
              <p className="text-body">
                <span className="font-medium">{g.label}</span>
                {' · '}
                {t('groups.summary', {
                  seats: g.seats,
                  where: g.items.map(itemName).join(', '),
                  seated: g.seated,
                  unused: g.unused,
                })}
              </p>
              {canWrite && g.unused > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <form action={seatAction}>
                    <input type="hidden" name="label" value={g.label} />
                    <Button type="submit" size="sm" disabled={seating}>
                      {t('groups.seatMembers', { label: g.label })}
                    </Button>
                  </form>
                  <form action={releaseAction}>
                    <input type="hidden" name="label" value={g.label} />
                    <Button type="submit" size="sm" variant="secondary" disabled={releasing}>
                      {t('groups.release', { label: g.label })}
                    </Button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div aria-live="polite">
        {outcome?.ok ? (
          <Alert
            tone="info"
            title={t('groups.released', { count: outcome.count ?? 0, label: outcome.label ?? '' })}
          />
        ) : outcome?.code ? (
          <Alert
            title={
              outcome.code === 'forbidden'
                ? t('groups.errors.forbidden')
                : outcome.done === 'seated' && outcome.code === 'validation_failed'
                  ? t('groups.errors.noMembers', { label: outcome.label ?? '' })
                  : te(errorMessageKey(outcome.code))
            }
          />
        ) : null}
      </div>
      {canWrite ? (
        <form
          // Submitted by hand so the fields keep what was typed when the server points at an error.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => formAction(fd));
          }}
          noValidate
          aria-labelledby="groups-form-heading"
          className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-3"
        >
          <h3 id="groups-form-heading" className="w-full text-body font-medium">
            {t('groups.form.title')}
          </h3>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="group-label" className="text-caption text-zinc-600">
              {t('groups.form.label')}
            </label>
            <input
              id="group-label"
              name="label"
              maxLength={40}
              list="group-label-suggestions"
              autoComplete="off"
              aria-invalid={invalid('label')}
              aria-describedby="group-label-hint"
              className={cls}
            />
            <span id="group-label-hint" className="text-caption text-zinc-500">
              {t('groups.form.labelHint')}
            </span>
            <datalist id="group-label-suggestions">
              {labels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="group-item" className="text-caption text-zinc-600">
              {t('groups.form.item')}
            </label>
            <select
              id="group-item"
              name="itemId"
              defaultValue=""
              aria-invalid={invalid('itemId')}
              className={cls}
            >
              <option value="">{t('assign.form.choose')}</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {t('assign.form.option', { item: itemName(i), free: i.free, capacity: i.capacity })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="group-count" className="text-caption text-zinc-600">
              {t('groups.form.count')}
            </label>
            <input
              id="group-count"
              name="count"
              type="number"
              inputMode="numeric"
              min={1}
              max={2000}
              aria-invalid={invalid('count')}
              aria-describedby="group-count-hint"
              className={`${cls} w-32`}
            />
            <span id="group-count-hint" className="text-caption text-zinc-500">
              {t('groups.form.countHint')}
            </span>
          </div>
          <Button type="submit" disabled={pending}>
            {t('groups.form.submit')}
          </Button>
          <div aria-live="polite" className="basis-full">
            {state.ok && state.done === 'allocated' ? (
              <Alert
                tone="info"
                title={t('groups.allocated', {
                  count: state.count ?? 0,
                  label: state.label ?? '',
                  item: itemName(items.find((i) => i.id === state.item) ?? { kind: 'table', label: '' }),
                })}
              />
            ) : state.code ? (
              <Alert
                title={
                  state.field
                    ? t(`groups.errors.${state.field}`)
                    : state.reason === 'not_enough_seats'
                      ? t('groups.errors.notEnough', { fits: state.fits ?? 0 })
                      : state.code === 'forbidden'
                        ? t('groups.errors.forbidden')
                        : te(errorMessageKey(state.code))
                }
              />
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
