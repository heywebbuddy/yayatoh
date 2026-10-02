'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { keepValues } from '@/lib/keep-values.ts';
import type { GroupState } from './actions.ts';

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
  const selectClass = (name: string) =>
    `min-h-11 rounded-pill border bg-surface px-4 text-body ${bad.has(name) ? 'border-danger' : 'border-line'}`;
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
      <Card className="flex flex-col gap-4">
        <h2 className="text-section">{t('payerTitle')}</h2>
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
      </Card>
      {Array.from({ length: count }, (_, k) => k + 1).map((i) => (
        <Card key={i} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-4">
            <legend className="text-section">{t('personTitle', { n: i })}</legend>
            <Input name={`name-${i}`} required label={t('name')} error={fieldError(`name-${i}`)} />
            <Input
              name={`email-${i}`}
              type="email"
              required
              label={t('email')}
              error={fieldError(`email-${i}`)}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`pass-${i}`} className="text-caption text-ink-2">
                {t('pass')}
              </label>
              <select
                id={`pass-${i}`}
                name={`pass-${i}`}
                defaultValue=""
                aria-invalid={bad.has(`pass-${i}`) ? true : undefined}
                aria-describedby={bad.has(`pass-${i}`) ? `pass-${i}-error` : undefined}
                className={selectClass(`pass-${i}`)}
              >
                <option value="" disabled>
                  {t('choosePass')}
                </option>
                {passes.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {bad.has(`pass-${i}`) ? (
                <p id={`pass-${i}-error`} className="text-caption text-danger">
                  {fieldError(`pass-${i}`)}
                </p>
              ) : null}
            </div>
          </fieldset>
        </Card>
      ))}
      {verify ? (
        <Card>
          <section aria-labelledby="group-verify-title" className="flex flex-col gap-3">
            <h2 id="group-verify-title" className="text-section">
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
        </Card>
      ) : null}
      <div aria-live="assertive">{general ? <Alert title={general} /> : null}</div>
      {verify ? null : (
        <Button type="submit" size="lg" disabled={pending} className="self-start">
          {t('submit', { count })}
        </Button>
      )}
    </form>
  );
}
