'use client';

import { Alert, Button, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { keepValues } from '@/lib/keep-values.ts';
import type { GroupState } from './actions.ts';

/** The public event page's card (ADR 0022). */
const panel =
  'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6';

/**
 * Group registration form (M5.1c): the payer, then one block per person (name, email, pass). The
 * number of people is chosen before (a link per count), so the form works without scripts too.
 * Rejected inputs get `aria-invalid` and their message; focus moves to the first one.
 */
export function GroupForm({
  action,
  count,
  passes,
}: {
  action: (prev: GroupState, form: FormData) => Promise<GroupState>;
  count: number;
  passes: readonly { value: string; label: string }[];
}) {
  const t = useTranslations('registration.group');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null } as GroupState);
  const ref = useRef<HTMLFormElement>(null);
  const bad = new Set(state.fields ?? []);
  useEffect(() => {
    const first = state.fields?.[0];
    if (first) ref.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }, [state]);
  const fieldError = (name: string) => {
    if (!bad.has(name)) return undefined;
    if (state.reason && t.has(`errors.${state.reason}`)) return t(`errors.${state.reason}`);
    const kind = name.replace(/-\d+$/, '');
    return t(`errors.field.${kind}`);
  };
  const verify = state.code === 'verify_email' ? state.verify : undefined;
  const known = (f: string) => /^(payerName|payerEmail|(name|email|pass)-\d+)$/.test(f);
  const general =
    state.code && state.code !== 'verify_email' && !(state.fields ?? []).some(known)
      ? state.code === 'rate_limited'
        ? tr('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
        : state.reason && t.has(`errors.${state.reason}`)
          ? t(`errors.${state.reason}`)
          : tr(errorMessageKey(state.code))
      : null;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      aria-label={t('formLabel')}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="count" value={count} />
      <div className={panel}>
        <h2 className="m-0 text-section text-ink">{t('payerTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name="payerName"
            required
            autoComplete="name"
            label={t('payerName')}
            error={fieldError('payerName')}
          />
          <Input
            name="payerEmail"
            type="email"
            required
            autoComplete="email"
            label={t('payerEmail')}
            hint={t('payerEmailHint')}
            error={fieldError('payerEmail')}
          />
        </div>
      </div>
      {Array.from({ length: count }, (_, k) => k + 1).map((i) => (
        <fieldset key={i} className={`m-0 min-w-0 ${panel}`}>
          <legend className="float-start mb-1 w-full text-section text-ink">
            {t('personTitle', { n: i })}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name={`name-${i}`} required label={t('name')} error={fieldError(`name-${i}`)} />
            <Input
              name={`email-${i}`}
              type="email"
              required
              label={t('email')}
              error={fieldError(`email-${i}`)}
            />
          </div>
          <Select
            id={`pass-${i}`}
            name={`pass-${i}`}
            defaultValue=""
            label={t('pass')}
            error={fieldError(`pass-${i}`)}
          >
            <option value="" disabled>
              {t('choosePass')}
            </option>
            {passes.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </fieldset>
      ))}
      {verify ? (
        <section aria-labelledby="group-verify-title" className={panel}>
          <h2 id="group-verify-title" className="m-0 text-section text-ink">
            {tr('guestVerify.title')}
          </h2>
          {verify.token ? <input type="hidden" name="verifyToken" value={verify.token} /> : null}
          <GuestCodeFields
            email={verify.email}
            status={verify.status}
            attemptsLeft={verify.attemptsLeft}
            resendAt={verify.resendAt}
            submitLabel={t('verifyAndPay')}
            pending={pending}
            idPrefix="group-verify"
          />
        </section>
      ) : null}
      <div aria-live="assertive">{general ? <Alert title={general} /> : null}</div>
      {verify ? null : (
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {t('submit', { count })}
        </Button>
      )}
    </form>
  );
}
