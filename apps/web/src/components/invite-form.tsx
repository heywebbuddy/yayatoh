'use client';

import { Alert, Button, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';

import type { ActionState } from '@/app/[locale]/o/[org]/(org)/team/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

const ROLES = [
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
  'owner',
] as const;

export function InviteForm({
  action,
  roles = ROLES,
  defaultRole = 'manager',
  labels = 'roles',
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  /** M4.2a: an event team invites co-hosts and planners. */
  roles?: readonly string[];
  defaultRole?: string;
  labels?: 'roles' | 'eventRoles';
}) {
  const t = useTranslations();
  // Inviting grants a role: a step-up command (M1.2c).
  const [state, formAction, pending, formRef] = useStepUpActionState(action, { ok: false, code: null });
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex-1">
        <Input name="email" type="email" required autoComplete="off" label={t('team.inviteEmail')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-[13px] font-bold text-ink">
          {t('team.role')}
        </label>
        <Select id="invite-role" name="role" defaultValue={defaultRole} className="field">
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`${labels}.${r}`)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {t('team.invite')}
      </Button>
      <div aria-live="polite" className="md:basis-full">
        {state.ok ? <Alert tone="info" title={t('team.invited')} /> : null}
        {state.code ? (
          <Alert
            title={
              state.reason === 'pending_invitation'
                ? t('team.errors.pending_invitation')
                : t(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </form>
  );
}
