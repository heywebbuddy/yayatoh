'use client';

import { Alert, Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef } from 'react';
import type { DoorStaffFormState } from '@/app/[locale]/o/[org]/e/[event]/onsite/staff/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * Add a door-staff member, or change where one scans. The checkpoints are a list of checkboxes
 * (a keyboard-friendly multi-select); none ticked = the whole event.
 */
export function DoorStaffForm({
  action,
  checkpoints,
  members,
  member,
  selected = [],
}: {
  action: (prev: DoorStaffFormState, form: FormData) => Promise<DoorStaffFormState>;
  checkpoints: readonly { id: string; name: string; kind: 'entrance' | 'zone' | 'session' }[];
  /** Add mode: the members to choose from. */
  members?: readonly { id: string; name: string }[];
  /** Edit mode: the member being edited. */
  member?: { id: string; name: string };
  selected?: readonly string[];
}) {
  const t = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.kind === 'saved' && !member) ref.current?.reset();
  }, [state, member]);
  const error =
    state.kind !== 'error'
      ? null
      : state.field === 'userId'
        ? t('doorStaff.chooseMemberError')
        : state.field === 'checkpointIds'
          ? t('doorStaff.checkpointGone')
          : t(errorMessageKey(state.code));
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4">
      {member ? (
        <input type="hidden" name="userId" value={member.id} />
      ) : (
        <div className="flex flex-col gap-1.5 self-start">
          <label htmlFor={`${id}-member`} className="text-[13px] font-bold text-ink">
            {t('doorStaff.member')}
          </label>
          <Select
            id={`${id}-member`}
            name="userId"
            defaultValue=""
            aria-invalid={state.kind === 'error' && state.field === 'userId' ? true : undefined}
            className="field"
          >
            <option value="">{t('doorStaff.chooseMember')}</option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">
          {member ? t('doorStaff.whereFor', { name: member.name }) : t('doorStaff.where')}
        </legend>
        <p className="text-caption text-ink-2">{t('doorStaff.whereHint')}</p>
        {checkpoints.length === 0 ? (
          <p className="text-body text-ink-2">{t('doorStaff.noCheckpoints')}</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {checkpoints.map((c) => (
              <label key={c.id} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="checkbox"
                  name="checkpointIds"
                  value={c.id}
                  defaultChecked={selected.includes(c.id)}
                  className="size-5 accent-primary"
                />
                {c.name}
                <span className="text-caption text-ink-2">
                  (
                  {c.kind === 'entrance'
                    ? t('checkpoints.entrance')
                    : c.kind === 'session'
                      ? t('sessionCheckin.sessionDoor')
                      : t('checkpoints.zone')}
                  )
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div aria-live="polite">
        {state.kind === 'saved' ? <Alert tone="info" title={t('doorStaff.saved')} /> : null}
        {error ? <Alert title={error} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {member ? t('doorStaff.saveFor', { name: member.name }) : t('doorStaff.add')}
      </Button>
    </form>
  );
}
