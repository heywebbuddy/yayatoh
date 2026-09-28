'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
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
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
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
        <label htmlFor="invite-role" className="text-caption text-zinc-600">
          {t('team.role')}
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="manager"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {t('team.invite')}
      </Button>
      <div aria-live="polite" className="md:basis-full">
        {state.ok ? <Alert tone="info" title={t('team.invited')} /> : null}
        {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
    </form>
  );
}
