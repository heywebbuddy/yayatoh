'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { RegistrationState } from '@/app/[locale]/events/[slug]/register/actions.ts';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: RegistrationState, form: FormData) => Promise<RegistrationState>;

/**
 * Public registration (M5.1a): first the address (and a registration code, if the buyer has one);
 * then only the types they may pick, each with its price range; one pass and any add-ons; the
 * emailed code; then payment. A full type offers its waitlist instead. Radios and checkboxes only
 * (keyboard-operable); errors are announced and focus the field to fix.
 */
export function RegistrationForm({ find, register }: { find: Action; register: Action }) {
  const t = useTranslations('registration.public');
  const tr = useTranslations();
  const [found, findAction, finding] = useActionState(find, { code: null } as RegistrationState);
  const [state, registerAction, pending] = useActionState(register, { code: null } as RegistrationState);
  // The latest options: a registration attempt may refresh them (a type filled up meanwhile).
  const options = state.options ?? found.options;
  const [typeId, setTypeId] = useState<string>('');
  // M5.1d: pay now by card, or later by invoice (types that offer it).
  const [payment, setPayment] = useState<'card' | 'invoice'>('card');
  const type = options?.types.find((x) => x.id === typeId) ?? null;
  const step2 = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (found.options) step2.current?.focus();
  }, [found]);
  useEffect(() => {
    if (state.joined) doneRef.current?.focus();
    else if (state.field) formRef.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);
  const message = (s: RegistrationState, inline: readonly string[]) =>
    s.code === null || s.code === 'verify_email' || (s.field && inline.includes(s.field))
      ? null
      : s.code === 'rate_limited'
        ? tr('errors.rateLimitedRetry', { minutes: s.retryMinutes ?? 1 })
        : s.reason && t.has(`errors.${s.reason}`)
          ? t(`errors.${s.reason}`)
          : s.field && t.has(`errors.field.${s.field}`)
            ? t(`errors.field.${s.field}`)
            : tr(errorMessageKey(s.code));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => registerAction(data));
  };
  if (state.joined)
    return (
      <div ref={doneRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <Alert
          tone="info"
          title={
            state.joined.alreadyJoined
              ? tr('waitlist.alreadyJoined', { position: state.joined.position ?? 0 })
              : tr('waitlist.joined', { position: state.joined.position ?? 0 })
          }
        >
          {tr('waitlist.joinedHint')}
        </Alert>
        <Link href={state.joined.href} className="self-start text-body underline underline-offset-2">
          {tr('waitlist.seeMyPlace')}
        </Link>
      </div>
    );
  const findError = message(found, ['email']);
  const error = message(state, ['name', 'poNumber']);
  const admissions = type?.items.filter((i) => i.kind === 'admission') ?? [];
  const addOns = type?.items.filter((i) => i.kind === 'add_on') ?? [];
  const verify = state.code === 'verify_email' ? state.verify : undefined;
  return (
    <div className="flex flex-col gap-6">
      <form action={findAction} aria-label={t('whoLabel')} className="flex flex-col gap-4" noValidate>
        <Card className="flex flex-col gap-4">
          <h2 className="text-section">{t('whoTitle')}</h2>
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              <Input
                name="email"
                type="email"
                required
                autoComplete="email"
                label={t('email')}
                defaultValue={options?.email}
                error={found.field === 'email' ? t('errors.field.email') : undefined}
              />
            </div>
            <div className="flex-1">
              <Input
                name="accessCode"
                autoComplete="off"
                label={t('code')}
                hint={t('codeHint')}
                defaultValue={options?.accessCode}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={finding}
            variant={options ? 'secondary' : 'primary'}
            className="self-start"
          >
            {t('showOptions')}
          </Button>
          <div aria-live="assertive">{findError ? <Alert title={findError} /> : null}</div>
        </Card>
      </form>
      {options ? (
        <form
          ref={formRef}
          onSubmit={submit}
          action={registerAction}
          aria-label={t('registerLabel')}
          className="flex flex-col gap-4"
          noValidate
        >
          <input type="hidden" name="email" value={options.email} />
          <input type="hidden" name="accessCode" value={options.accessCode} />
          <h2 ref={step2} tabIndex={-1} className="text-section outline-none">
            {t('chooseTitle')}
          </h2>
          {options.types.length === 0 ? (
            <Alert tone="info" title={t('noneTitle')}>
              {t('none')}
            </Alert>
          ) : (
            <Card className="flex flex-col gap-4">
              <fieldset
                className="flex flex-col gap-2"
                aria-invalid={state.field === 'type' ? true : undefined}
              >
                <legend className="mb-1 text-[13px] font-bold text-ink">{t('type')}</legend>
                {options.types.map((x) => (
                  <label key={x.id} className="flex min-h-6 items-start gap-2.5 text-body">
                    <input
                      type="radio"
                      name="type"
                      value={x.id}
                      checked={typeId === x.id}
                      onChange={() => setTypeId(x.id)}
                      className="mt-0.5 size-5 accent-primary"
                    />
                    <span className="flex flex-col">
                      <span>
                        {x.name} · {x.priceLabel}
                        {x.apply ? ` · ${t('byApplication')}` : x.full ? ` · ${t('full')}` : ''}
                      </span>
                      {x.description ? (
                        <span className="text-caption text-ink-2">{x.description}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
              {type ? (
                <>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-[13px] font-bold text-ink">{t('pass')}</legend>
                    {admissions.map((i, k) => (
                      <label key={i.id} className="flex min-h-6 items-center gap-2.5 text-body">
                        <input
                          type="radio"
                          name="admission"
                          value={i.id}
                          defaultChecked={k === 0}
                          className="size-5 accent-primary"
                        />
                        <span>
                          {i.name} · {i.priceLabel}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {addOns.length > 0 && !type.full ? (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-[13px] font-bold text-ink">{t('addOns')}</legend>
                      {addOns.map((i) => (
                        <label key={i.id} className="flex min-h-6 items-center gap-2.5 text-body">
                          <input
                            type="checkbox"
                            name="addOn"
                            value={i.id}
                            className="size-5 accent-primary"
                          />
                          <span>
                            {i.name} · {i.priceLabel}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <Input
                    name="name"
                    required
                    autoComplete="name"
                    label={t('name')}
                    error={state.field === 'name' ? t('errors.field.name') : undefined}
                  />
                  {type.apply ? (
                    <>
                      <p className="text-body text-ink-2">{t('applyHint')}</p>
                      <Input
                        name="company"
                        autoComplete="organization"
                        maxLength={120}
                        label={t('company')}
                      />
                      <Input
                        name="jobTitle"
                        autoComplete="organization-title"
                        maxLength={120}
                        label={t('jobTitle')}
                      />
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="registration-message" className="text-caption text-ink-2">
                          {t('message')}
                        </label>
                        <textarea
                          id="registration-message"
                          name="message"
                          rows={3}
                          maxLength={2000}
                          className="rounded-card border border-line bg-surface px-4 py-2 text-body"
                        />
                      </div>
                    </>
                  ) : null}
                  {type.payLater && !type.full && !type.apply ? (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-body font-medium">{t('payTitle')}</legend>
                      {(['card', 'invoice'] as const).map((k) => (
                        <label key={k} className="flex min-h-6 items-start gap-2.5 text-body">
                          <input
                            type="radio"
                            name="payment"
                            value={k}
                            checked={payment === k}
                            onChange={() => setPayment(k)}
                            className="mt-0.5 size-5 accent-ink"
                          />
                          <span className="flex flex-col">
                            <span>{t(k === 'card' ? 'payNow' : 'payLater')}</span>
                            {k === 'invoice' ? (
                              <span className="text-caption text-ink-2">{t('payLaterHint')}</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  {type.payLater && payment === 'invoice' && !type.full && !type.apply ? (
                    <>
                      {type.poNumber !== 'off' ? (
                        <Input
                          name="poNumber"
                          maxLength={60}
                          autoComplete="off"
                          required={type.poNumber === 'required'}
                          label={type.poNumber === 'required' ? t('poNumberRequired') : t('poNumber')}
                          hint={t('poNumberHint')}
                          error={state.field === 'poNumber' ? t('errors.field.poNumber') : undefined}
                        />
                      ) : null}
                      <Input
                        name="billingCompany"
                        maxLength={120}
                        autoComplete="organization"
                        label={t('billingCompany')}
                      />
                    </>
                  ) : null}
                  {type.full && !type.apply ? (
                    <Alert tone="info" title={t('fullTitle', { type: type.name })}>
                      {t('fullHint')}
                    </Alert>
                  ) : null}
                  <div className={verify ? 'hidden' : 'contents'}>
                    {type.apply ? (
                      <Button
                        type="submit"
                        name="intent"
                        value="apply"
                        disabled={pending}
                        className="self-start"
                      >
                        {t('apply')}
                      </Button>
                    ) : type.full ? (
                      <Button
                        type="submit"
                        name="intent"
                        value="waitlist"
                        disabled={pending}
                        className="self-start"
                      >
                        {t('joinWaitlist')}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        name="intent"
                        value="register"
                        disabled={pending}
                        className="self-start"
                      >
                        {type.payLater && payment === 'invoice' ? t('registerInvoice') : t('register')}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-caption text-ink-2">{t('pickType')}</p>
              )}
            </Card>
          )}
          {verify ? (
            <Card>
              <section aria-labelledby="registration-verify-title" className="flex flex-col gap-3">
                <h2 id="registration-verify-title" className="text-section">
                  {tr('guestVerify.title')}
                </h2>
                <input
                  type="hidden"
                  name="intent"
                  value={type?.apply ? 'apply' : type?.full ? 'waitlist' : 'register'}
                />
                {verify.token ? <input type="hidden" name="verifyToken" value={verify.token} /> : null}
                <GuestCodeFields
                  email={verify.email}
                  status={verify.status}
                  attemptsLeft={verify.attemptsLeft}
                  resendAt={verify.resendAt}
                  submitLabel={t('verifyAndContinue')}
                  pending={pending}
                  idPrefix="registration-verify"
                />
              </section>
            </Card>
          ) : null}
          <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
        </form>
      ) : null}
    </div>
  );
}
