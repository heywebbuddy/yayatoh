'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { WaitlistJoinState } from '@/app/[locale]/events/[slug]/waitlist/actions.ts';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface WaitlistPassView {
  readonly id: string;
  readonly name: string;
  readonly priceLabel: string;
  readonly minPerOrder: number;
  readonly maxPerOrder: number;
}

/**
 * Join a sold-out pass's waitlist: which pass, how many, name and email; then the emailed code
 * (M1.5f), then the place in line with the person's own link. Works by keyboard; errors are
 * announced and focus the field to fix.
 */
export function WaitlistJoinForm({
  passes,
  initialPass,
  date,
  action,
}: {
  passes: readonly WaitlistPassView[];
  initialPass: string | null;
  date: string | null;
  action: (prev: WaitlistJoinState, form: FormData) => Promise<WaitlistJoinState>;
}) {
  const t = useTranslations('waitlist');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null } as WaitlistJoinState);
  const [pass, setPass] = useState(initialPass ?? passes[0]?.id ?? '');
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const chosen = passes.find((p) => p.id === pass) ?? passes[0];
  const ref = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.joined) done.current?.focus();
    else if (state.field) ref.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);
  const verify =
    state.code === 'verify_email' && state.verify
      ? typedEmail === null || typedEmail.trim().toLowerCase() === state.verify.email.toLowerCase()
        ? state.verify
        : null
      : null;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
  if (state.joined) {
    return (
      <div ref={done} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <Alert
          tone="info"
          title={
            state.joined.alreadyJoined
              ? t('alreadyJoined', { position: state.joined.position ?? 0 })
              : t('joined', { position: state.joined.position ?? 0 })
          }
        >
          {t('joinedHint')}
        </Alert>
        <Link href={state.joined.href} className="self-start text-body underline underline-offset-2">
          {t('seeMyPlace')}
        </Link>
      </div>
    );
  }
  const error =
    state.code === null || state.code === 'verify_email'
      ? null
      : state.code === 'rate_limited'
        ? tr('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
        : state.reason && t.has(`errors.${state.reason}`)
          ? t(`errors.${state.reason}`)
          : state.field && t.has(`errors.field.${state.field}`)
            ? t(`errors.field.${state.field}`)
            : tr(errorMessageKey(state.code));
  const max = Math.max(chosen?.minPerOrder ?? 1, chosen?.maxPerOrder ?? 1);
  const min = chosen?.minPerOrder ?? 1;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={onSubmit}
      aria-label={t('formLabel')}
      className="flex flex-col gap-4"
      noValidate
    >
      {date ? <input type="hidden" name="date" value={date} /> : null}
      <Card className="flex flex-col gap-4">
        {passes.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-body font-medium">{t('pass')}</legend>
            {passes.map((p) => (
              <label key={p.id} className="flex min-h-6 items-center gap-2.5 text-body">
                <input
                  type="radio"
                  name="pass"
                  value={p.id}
                  checked={pass === p.id}
                  onChange={() => setPass(p.id)}
                  className="size-5 accent-ink"
                />
                <span>
                  {p.name} · {t('priceEach', { price: p.priceLabel })}
                </span>
              </label>
            ))}
          </fieldset>
        ) : chosen ? (
          <>
            <input type="hidden" name="pass" value={chosen.id} />
            <p className="text-body">
              <span className="font-medium">{chosen.name}</span> ·{' '}
              {t('priceEach', { price: chosen.priceLabel })}
            </p>
          </>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="waitlist-quantity" className="text-body font-medium">
            {t('quantity')}
          </label>
          <select
            id="waitlist-quantity"
            name="quantity"
            key={chosen?.id}
            defaultValue={String(min)}
            aria-invalid={state.field === 'quantity' ? true : undefined}
            className="min-h-10 w-28 rounded-pill border border-zinc-200 bg-white px-4 text-body text-zinc-900"
          >
            {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="flex-1">
            <Input
              name="name"
              required
              autoComplete="name"
              label={t('name')}
              error={state.field === 'name' ? t('errors.field.name') : undefined}
            />
          </div>
          <div className="flex-1">
            <Input
              name="email"
              type="email"
              required
              autoComplete="email"
              label={t('email')}
              error={state.field === 'email' ? t('errors.field.email') : undefined}
              onChange={(e) => setTypedEmail(e.currentTarget.value)}
            />
          </div>
        </div>
        <p className="text-caption text-zinc-600">{t('transactionalOnly')}</p>
        <div className={verify ? 'hidden' : 'contents'}>
          <Button type="submit" disabled={pending} className="self-start">
            {t('join')}
          </Button>
        </div>
      </Card>
      {verify ? (
        <Card>
          <section aria-labelledby="waitlist-verify-title" className="flex flex-col gap-3">
            <h2 id="waitlist-verify-title" className="text-section">
              {tr('guestVerify.title')}
            </h2>
            {verify.token ? <input type="hidden" name="verifyToken" value={verify.token} /> : null}
            <GuestCodeFields
              email={verify.email}
              status={verify.status}
              attemptsLeft={verify.attemptsLeft}
              resendAt={verify.resendAt}
              submitLabel={t('verifyAndJoin')}
              pending={pending}
              idPrefix="waitlist-verify"
            />
            <p className="text-caption text-zinc-600">{tr('guestVerify.changeEmail')}</p>
          </section>
        </Card>
      ) : null}
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}
