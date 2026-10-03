'use client';

import { Alert, Button, Card, Checkbox, Input, Radio } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import type { AgencyGrantState } from './actions.ts';

const ROLES = ['manager', 'marketing', 'viewer'] as const;
const ROLE_KEY = { manager: 'roleManager', marketing: 'roleMarketing', viewer: 'roleViewer' } as const;
const FIELD_KEY = {
  required: 'agencyRequired',
  unknown: 'agencyUnknown',
  self: 'agencySelf',
  taken: 'agencyTaken',
} as const;

/**
 * Give an agency access (M6.7a): its address, what it may do, and the explicit money opt-in (off
 * by default). Granting is a step-up command: "Confirm it's you" opens and the form resubmits.
 */
export function AgencyGrantForm({
  action,
}: {
  action: (prev: AgencyGrantState, form: FormData) => Promise<AgencyGrantState>;
}) {
  const t = useTranslations('agencies');
  const tr = useTranslations();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as AgencyGrantState);
  const values = state.kind === 'error' ? state.values : null;
  const fieldError = state.kind === 'error' && state.agency ? t(FIELD_KEY[state.agency]) : undefined;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{t('grantTitle')}</h2>
      {/* Server validation owns the messages (the command's rules). */}
      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="flex flex-col gap-4"
        // A new key after success clears the fields for the next grant.
        key={state.kind === 'granted' ? `done-${state.agency}` : 'form'}
      >
        <Input
          name="agency"
          maxLength={63}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          label={t('agency')}
          hint={t('agencyHint')}
          defaultValue={values?.agency ?? ''}
          error={fieldError}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[13px] font-bold text-ink">{t('role')}</legend>
          {ROLES.map((r) => (
            <Radio
              key={r}
              name="role"
              value={r}
              id={`agency-role-${r}`}
              defaultChecked={(values?.role ?? 'manager') === r}
              label={t(ROLE_KEY[r])}
              hint={t(`${ROLE_KEY[r]}Hint`)}
            />
          ))}
        </fieldset>
        <Checkbox
          name="finance"
          id="agency-finance"
          defaultChecked={values?.finance ?? false}
          label={t('finance')}
          hint={t('financeHint')}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {t('grant')}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.kind === 'granted' ? (
          <Alert tone="success" title={t('granted', { agency: state.agency })} />
        ) : state.kind === 'error' && !state.agency ? (
          <Alert title={tr(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
