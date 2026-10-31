'use client';

import { Alert, Button, cx, Input, Select } from '@yayatoh/ui';
import { Check, Lock, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import type { SelfServeState } from '@/app/[locale]/signup/self-serve-actions.ts';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import { Link } from '@/i18n/navigation.ts';
import { SalesButton, type SalesProps } from './sales-modal.tsx';

export interface PlanCard {
  /** The catalog key (`tier_pro`); empty for a plan that is not on sale. */
  readonly key: string;
  readonly id: 'free' | 'starter' | 'pro' | 'agency';
  readonly name: string;
  readonly blurb: string;
  readonly monthly: string | null;
  readonly yearly: string | null;
  /** The yearly price per month, for the "save" hint. */
  readonly yearlyPerMonth: string | null;
  readonly free: boolean;
  readonly available: boolean;
  /** Paid and not sellable because online payment is not switched on: "coming soon". */
  readonly soon: boolean;
  readonly highlights: readonly string[];
}

const PROFILES = [
  'wedding',
  'gala',
  'concert',
  'conference',
  'community',
  'tour',
  'agency',
  'other',
] as const;
const COUNTRIES =
  'AE AR AT AU BD BE BR CA CH CL CN CO CZ DE DK EG ES FI FR GB GH GR HK HU ID IE IL IN IT JP KE KR LK MX MY NG NL NO NP NZ PE PH PK PL PT QA RO SA SE SG TH TR TW TZ UA UG US VN ZA'.split(
    ' ',
  );

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

/**
 * The self-service sign-up: pick a plan (monthly or yearly), verify the email, name the
 * organization and, for a paid plan, go on to the provider's checkout. A free plan opens the
 * organization at once. Enterprise is the only plan that talks to sales (a popup with the form).
 */
export function SelfServeSignup({
  action,
  plans,
  initialPlan,
  initialInterval,
  notice,
  signedInEmail,
  humanCheck,
  sales,
  defaultCountry,
}: {
  action: (prev: SelfServeState, form: FormData) => Promise<SelfServeState>;
  plans: readonly PlanCard[];
  initialPlan: string;
  initialInterval: 'month' | 'year';
  /** Why the picker shows a note: paid plans not on sale, or the plan in the link is unknown. */
  notice: 'paidSoon' | 'planUnknown' | null;
  signedInEmail: string | null;
  humanCheck: HumanCheckWidget | null;
  sales: SalesProps;
  defaultCountry: string;
}) {
  const t = useTranslations('selfServe');
  const ts = useTranslations('signup');
  const tp = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { error: null });
  const firstOpen = plans.find((p) => p.available)?.id ?? plans[0]?.id ?? 'free';
  const [plan, setPlan] = useState(
    notice === 'planUnknown'
      ? ''
      : plans.some((p) => p.id === initialPlan && p.available)
        ? initialPlan
        : firstOpen,
  );
  const [interval, setInterval] = useState<'month' | 'year'>(initialInterval);
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [tz, setTz] = useState('');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const chosen = plans.find((p) => p.id === plan);
  const price = chosen ? (interval === 'year' ? chosen.yearly : chosen.monthly) : null;
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const countries = COUNTRIES.map((c) => ({
    value: c,
    label: names.of(c) ?? c,
    text: names.of(c) ?? c,
  })).sort((a, b) => a.text.localeCompare(b.text, locale));
  const message = state.error
    ? state.error === 'slug_taken'
      ? ts('slugTaken')
      : state.error === 'rate_limited'
        ? tp('errors.rateLimitedRetry', { minutes: state.minutes ?? 60 })
        : state.error === 'human_check'
          ? ts('humanCheck')
          : state.error === 'email_unverified'
            ? ts('verifyEmail')
            : t(`errors.${state.error}`)
    : null;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="ss-plan" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ss-plan" className="m-0 font-display text-[22px] font-black text-ink uppercase">
              <span className="me-2 text-ember">1</span>
              {t('steps.plan')}
            </h2>
            <fieldset className="m-0 inline-flex gap-1 rounded-pill border border-line bg-surface p-1">
              <legend className="sr-only">{t('interval.label')}</legend>
              {(['month', 'year'] as const).map((i) => (
                <label
                  key={i}
                  className={cx(
                    'inline-flex min-h-10 cursor-pointer items-center rounded-pill px-4 text-body font-bold transition-colors motion-reduce:transition-none',
                    interval === i ? 'bg-ember-soft text-white' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  <input
                    type="radio"
                    name="intervalPick"
                    value={i}
                    checked={interval === i}
                    onChange={() => setInterval(i)}
                    className="sr-only"
                  />
                  {t(`interval.${i}`)}
                  {i === 'year' ? (
                    <span className="ms-2 rounded-pill bg-white/20 px-2 text-caption">
                      {t('interval.save')}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          </div>
          {notice ? (
            <div
              role="status"
              className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-surface-2 p-4"
            >
              <p className="m-0 text-body text-ink">{t(`notice.${notice}`)}</p>
              {notice === 'paidSoon' ? <SalesButton {...sales} label={t('enterprise.cta')} /> : null}
            </div>
          ) : null}
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {plans.map((p) => {
              const shown = interval === 'year' ? p.yearly : p.monthly;
              const on = plan === p.id;
              return (
                <li key={p.id}>
                  <label
                    className={cx(
                      'relative flex h-full flex-col gap-3 rounded-[24px] border p-5 transition-all motion-reduce:transition-none',
                      p.available ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-not-allowed opacity-60',
                      on ? 'border-ember bg-surface-2 shadow-lg' : 'border-line bg-surface',
                    )}
                  >
                    <input
                      type="radio"
                      name="planPick"
                      value={p.id}
                      checked={on}
                      disabled={!p.available}
                      onChange={() => setPlan(p.id)}
                      className="peer sr-only"
                    />
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-display text-[20px] font-black text-ink uppercase">{p.name}</span>
                      <span
                        aria-hidden="true"
                        className={cx(
                          'inline-flex size-6 items-center justify-center rounded-full border',
                          on ? 'border-ember bg-ember text-white' : 'border-line-strong',
                        )}
                      >
                        {on ? <Check className="size-4" /> : null}
                      </span>
                    </span>
                    <span className="text-body text-ink-2">{p.blurb}</span>
                    <span className="font-display text-[26px] font-black text-ink">
                      {!p.available
                        ? t(p.soon ? 'comingSoon' : 'unavailable')
                        : p.free
                          ? t('freePrice')
                          : (shown ?? '—')}
                      {p.available && !p.free && shown ? (
                        <span className="ms-1 text-body font-normal text-ink-2">
                          / {t(`interval.per_${interval}`)}
                        </span>
                      ) : null}
                    </span>
                    {interval === 'year' && p.yearlyPerMonth ? (
                      <span className="text-caption text-ink-2">
                        {t('interval.perMonthEquivalent', { price: p.yearlyPerMonth })}
                      </span>
                    ) : null}
                    <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
                      {p.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2 text-caption text-ink">
                          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ember" />
                          {h}
                        </li>
                      ))}
                    </ul>
                    <span className="pointer-events-none absolute inset-0 rounded-[24px] ring-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ember" />
                  </label>
                </li>
              );
            })}
            <li>
              <div className="flex h-full flex-col gap-3 rounded-[24px] border border-dashed border-line-strong bg-surface p-5">
                <span className="font-display text-[20px] font-black text-ink uppercase">
                  {t('enterprise.name')}
                </span>
                <span className="text-body text-ink-2">{t('enterprise.body')}</span>
                <span className="font-display text-[26px] font-black text-ink">{t('enterprise.price')}</span>
                <SalesButton {...sales} label={t('enterprise.cta')} className="mt-auto self-start" />
              </div>
            </li>
          </ul>
        </section>

        <section aria-labelledby="ss-account" className="flex flex-col gap-5">
          <h2 id="ss-account" className="m-0 font-display text-[22px] font-black text-ink uppercase">
            <span className="me-2 text-ember">2</span>
            {t('steps.account')}
          </h2>
          {!signedInEmail ? (
            <div className="flex flex-col items-start gap-4 rounded-[24px] border border-line bg-surface p-6">
              <ShieldCheck aria-hidden="true" className="size-8 text-ember" />
              <p className="m-0 font-display text-[20px] font-black text-ink uppercase">
                {t('verify.title')}
              </p>
              <p className="m-0 text-body text-ink-2">{t('verify.body')}</p>
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/signup?plan=${plan}&interval=${interval}`)}`}
                className="inline-flex min-h-12 items-center rounded-pill bg-ember-soft px-6 font-bold text-white"
              >
                {ts('continueWithEmail')}
              </Link>
            </div>
          ) : (
            <form id="ss-form" action={formAction} className="flex flex-col gap-5">
              <input type="hidden" name="plan" value={chosen?.key ?? ''} />
              <input type="hidden" name="interval" value={interval} />
              <input type="hidden" name="timezone" value={tz} />
              <p className="m-0 text-caption text-ink-2">{ts('signedInAs', { email: signedInEmail })}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  name="personName"
                  required
                  maxLength={120}
                  autoComplete="name"
                  label={t('fields.personName')}
                />
                <Input
                  name="orgName"
                  required
                  minLength={2}
                  maxLength={120}
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    if (!touched) setSlug(slugify(e.target.value));
                  }}
                  label={ts('orgName')}
                />
                <Input
                  name="slug"
                  required
                  minLength={2}
                  maxLength={63}
                  pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
                  value={slug}
                  onChange={(e) => {
                    setTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  label={ts('slug')}
                  hint={ts('slugHint', { slug: slug || '…' })}
                  error={state.error === 'slug_taken' ? ts('slugTaken') : undefined}
                />
                <Select
                  name="country"
                  label={t('fields.country')}
                  defaultValue={defaultCountry}
                  searchable
                  options={countries}
                />
              </div>
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[13px] font-bold text-ink">{ts('profile')}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PROFILES.map((p, i) => (
                    <label
                      key={p}
                      className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-card border border-line bg-surface p-3 has-[:checked]:border-ember"
                    >
                      <input
                        type="radio"
                        name="profile"
                        value={p}
                        defaultChecked={i === 0}
                        className="mt-0.5 size-5 accent-primary"
                      />
                      <span className="flex flex-col">
                        <span className="text-body text-ink">{tp(`profiles.${p}`)}</span>
                        <span className="text-caption text-ink-2">{ts(`profileHint.${p}`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex min-h-6 items-start gap-2.5 text-body text-ink">
                <input
                  type="checkbox"
                  name="terms"
                  value="yes"
                  required
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span>
                  {tp.rich('signup.terms', {
                    tos: (c) => (
                      <Link href="/legal/platform/platform_tos" className="underline" target="_blank">
                        {c}
                      </Link>
                    ),
                    dpa: (c) => (
                      <Link href="/legal/platform/dpa" className="underline" target="_blank">
                        {c}
                      </Link>
                    ),
                  })}
                </span>
              </label>
              {humanCheck ? <HumanCheckField widget={humanCheck} /> : null}
              <div aria-live="polite">{message ? <Alert title={message} /> : null}</div>
            </form>
          )}
        </section>
      </div>

      <aside aria-labelledby="ss-summary" className="lg:sticky lg:top-28 lg:self-start">
        <div className="flex flex-col gap-4 rounded-[28px] border border-line bg-surface p-6">
          <h2 id="ss-summary" className="m-0 font-display text-[18px] font-black text-ink uppercase">
            <span className="me-2 text-ember">3</span>
            {t('steps.payment')}
          </h2>
          {chosen ? (
            <dl className="m-0 flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-body text-ink-2">{t('summary.plan')}</dt>
                <dd className="m-0 font-bold text-ink">{chosen.name}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-body text-ink-2">{t('summary.billing')}</dt>
                <dd className="m-0 font-bold text-ink">
                  {chosen.free ? t('freePrice') : t(`interval.${interval}`)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <dt className="text-body text-ink-2">{t('summary.total')}</dt>
                <dd className="m-0 font-display text-[28px] font-black text-ink">
                  {chosen.free ? t('freePrice') : (price ?? '—')}
                </dd>
              </div>
            </dl>
          ) : null}
          <p className="m-0 flex items-start gap-2 text-caption text-ink-2">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {chosen?.free ? t('summary.noPayment') : t('summary.secure')}
          </p>
          {signedInEmail ? (
            <Button type="submit" form="ss-form" disabled={pending || !chosen?.available} className="w-full">
              {chosen?.free ? t('submit.free') : t('submit.paid')}
            </Button>
          ) : (
            <p className="m-0 text-caption text-ink-2">{t('summary.verifyFirst')}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
