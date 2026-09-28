'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { WizardState } from '@/app/[locale]/o/[org]/(org)/events/new/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { readinessRules } from '@/lib/readiness.ts';

const PROFILES = ['conference', 'gala', 'concert', 'wedding', 'community', 'agency', 'other'] as const;
const MODES = ['in_person', 'online', 'hybrid'] as const;
const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Africa/Lagos',
  'Africa/Accra',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;
const STEPS = ['basics', 'when', 'tickets'] as const;
/** Fields with their own message under `wizard.errors.*`; others get the generic one. */
const KNOWN_ERRORS = new Set([
  'name',
  'tagline',
  'slug',
  'startsAt',
  'endsAt',
  'venueId',
  'venueName',
  'city',
  'ticketName',
  'ticketPrice',
  'ticketQuantity',
]);

type Values = Record<
  | 'name'
  | 'tagline'
  | 'profile'
  | 'timezone'
  | 'startsAt'
  | 'endsAt'
  | 'attendanceMode'
  | 'venueId'
  | 'venueName'
  | 'city'
  | 'ticketName'
  | 'ticketPrice'
  | 'ticketQuantity',
  string
>;
type Field = keyof Values;

/** Client-side checks per step (the server repeats every one of them). */
function validate(step: number, v: Values): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (step === 0) {
    const n = v.name.trim().length;
    if (n < 2 || n > 160) e.name = 'name';
    if (v.tagline.trim().length > 280) e.tagline = 'tagline';
  }
  if (step === 1) {
    if (!v.startsAt) e.startsAt = 'startsAt';
    if (!v.endsAt) e.endsAt = 'endsAt';
    // Same zone and the same `YYYY-MM-DDTHH:mm` shape: string order is time order.
    else if (v.startsAt && v.endsAt <= v.startsAt) e.endsAt = 'endsOrder';
  }
  if (step === 2 && (v.ticketName || v.ticketPrice || v.ticketQuantity)) {
    if (!v.ticketName.trim()) e.ticketName = 'ticketName';
    if (v.ticketPrice && !/^\d{1,12}([.,]\d{1,3})?$/.test(v.ticketPrice.trim()))
      e.ticketPrice = 'ticketPrice';
    const q = Number(v.ticketQuantity);
    if (!Number.isInteger(q) || q < 1) e.ticketQuantity = 'ticketQuantity';
  }
  return e;
}

/**
 * The three-step event wizard (M1.4f): basics → when and where → tickets and the publish
 * checklist. Back/Next keep every value; each step names its own errors; the stepper is an
 * ordered list with `aria-current="step"`, and focus moves to the step's heading.
 */
export function EventWizard({
  action,
  defaults,
  venues,
  currency,
  ticketing,
}: {
  action: (prev: WizardState, form: FormData) => Promise<WizardState>;
  defaults: { profile: string; timezone: string };
  venues: readonly { id: string; name: string; city: string | null }[];
  currency: string;
  /** Whether the org sells tickets (the first-pass fields and rule). */
  ticketing: boolean;
}) {
  const t = useTranslations('wizard');
  const tn = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const [requestKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [v, setV] = useState<Values>({
    name: '',
    tagline: '',
    profile: defaults.profile,
    timezone: defaults.timezone,
    startsAt: '',
    endsAt: '',
    attendanceMode: 'in_person',
    venueId: '',
    venueName: '',
    city: '',
    ticketName: '',
    ticketPrice: '',
    ticketQuantity: '',
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);
  // A server-side error names a field: go back to its step and show it there.
  useEffect(() => {
    if (state.code && state.step !== undefined) {
      setStep(state.step);
      const f = state.field;
      if (f) setErrors({ [f === 'slug' ? 'name' : f]: KNOWN_ERRORS.has(f) ? f : 'generic' } as never);
    }
  }, [state]);

  const set = (k: Field) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const go = (to: number) => {
    if (to > step) {
      const e = validate(step, v);
      setErrors(e);
      if (Object.keys(e).length) return;
    } else setErrors({});
    setStep(to);
    setReached((r) => Math.max(r, to));
  };
  const err = (k: Field) => (errors[k] ? t(`errors.${errors[k]}`) : undefined);
  const zones = ZONES.includes(defaults.timezone as (typeof ZONES)[number])
    ? ZONES
    : [defaults.timezone, ...ZONES];
  const selectClass = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
  const venue = venues.find((x) => x.id === v.venueId);
  const rules = readinessRules({
    name: v.name,
    status: 'draft',
    startsAt: new Date(`${v.startsAt || '2000-01-01T00:00'}Z`),
    endsAt: new Date(`${v.endsAt || '2000-01-01T00:00'}Z`),
    venueName: venue?.name ?? (v.venueName.trim() || null),
    attendanceMode: v.attendanceMode as (typeof MODES)[number],
    tagline: v.tagline,
    descriptionSections: 0,
    totalDates: 0,
    upcomingDates: 0,
    ticketTypes: v.ticketName.trim() ? 1 : 0,
    sessions: 0,
    speakers: 0,
    nav: new Set(ticketing ? ['ticketsOrders'] : []),
    now: new Date(0),
  });
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Card size="panel" className="flex max-w-2xl flex-col gap-5">
      <nav aria-label={t('stepsLabel')}>
        <ol className="flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => go(i)}
                disabled={i > reached || pending}
                aria-current={i === step ? 'step' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-pill border px-4 text-caption ${
                  i === step ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-700'
                } disabled:opacity-60`}
              >
                <span aria-hidden="true" className="font-mono">
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                {t('stepOf', { step: i + 1, total: STEPS.length, name: t(`steps.${s}`) })}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <h2 ref={heading} tabIndex={-1} className="text-section outline-none">
        {t(`steps.${STEPS[step] ?? 'basics'}`)}
      </h2>
      <div aria-live="polite">
        {hasErrors ? <Alert title={t('fixErrors')} /> : null}
        {state.code && !state.field ? <Alert title={tn(errorMessageKey(state.code))} /> : null}
      </div>

      <form
        action={formAction}
        onSubmit={(e) => {
          // Enter on steps 1–2 means Next; only the last step submits.
          if (step < STEPS.length - 1) {
            e.preventDefault();
            go(step + 1);
            return;
          }
          const e3 = validate(2, v);
          setErrors(e3);
          if (Object.keys(e3).length) e.preventDefault();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <input type="hidden" name="requestKey" value={requestKey} />
        {(Object.keys(v) as Field[]).map((k) =>
          // Fields of other steps travel as hidden inputs, so the last step submits everything.
          (step === 0 && ['name', 'tagline', 'profile'].includes(k)) ||
          (step === 1 &&
            ['timezone', 'startsAt', 'endsAt', 'attendanceMode', 'venueId', 'venueName', 'city'].includes(
              k,
            )) ||
          (step === 2 && ['ticketName', 'ticketPrice', 'ticketQuantity'].includes(k)) ? null : (
            <input key={k} type="hidden" name={k} value={v[k]} />
          ),
        )}

        {step === 0 ? (
          <>
            <Input
              id="wizard-name"
              name="name"
              required
              maxLength={160}
              label={t('name')}
              value={v.name}
              onChange={set('name')}
              error={err('name')}
            />
            <Input
              id="wizard-tagline"
              name="tagline"
              maxLength={280}
              label={t('tagline')}
              hint={t('taglineHint')}
              value={v.tagline}
              onChange={set('tagline')}
              error={err('tagline')}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wizard-profile" className="text-caption text-zinc-600">
                {t('profile')}
              </label>
              <select
                id="wizard-profile"
                name="profile"
                value={v.profile}
                onChange={set('profile')}
                className={selectClass}
              >
                {PROFILES.map((p) => (
                  <option key={p} value={p}>
                    {tn(`profiles.${p}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="wizard-timezone" className="text-caption text-zinc-600">
                {t('timezone')}
              </label>
              <select
                id="wizard-timezone"
                name="timezone"
                value={v.timezone}
                onChange={set('timezone')}
                className={selectClass}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <Input
              id="wizard-starts"
              name="startsAt"
              type="datetime-local"
              required
              label={t('startsAt')}
              hint={t('localTimeHint')}
              value={v.startsAt}
              onChange={set('startsAt')}
              error={err('startsAt')}
            />
            <Input
              id="wizard-ends"
              name="endsAt"
              type="datetime-local"
              required
              label={t('endsAt')}
              value={v.endsAt}
              onChange={set('endsAt')}
              error={err('endsAt')}
            />
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className="pb-1.5 text-caption text-zinc-600">{t('attendanceMode')}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {MODES.map((m) => (
                  <label key={m} className="flex min-h-6 items-center gap-2 text-body">
                    <input
                      type="radio"
                      name="attendanceMode"
                      value={m}
                      checked={v.attendanceMode === m}
                      onChange={set('attendanceMode')}
                      className="size-5"
                    />
                    {tn(`publicEvent.mode.${m}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            {venues.length > 0 ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="wizard-venue" className="text-caption text-zinc-600">
                  {t('savedVenue')}
                </label>
                <select
                  id="wizard-venue"
                  name="venueId"
                  value={v.venueId}
                  onChange={set('venueId')}
                  className={selectClass}
                >
                  <option value="">{t('noSavedVenue')}</option>
                  {venues.map((x) => (
                    <option key={x.id} value={x.id}>
                      {[x.name, x.city].filter(Boolean).join(', ')}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {v.venueId ? null : (
              <>
                <Input
                  id="wizard-venue-name"
                  name="venueName"
                  maxLength={160}
                  label={t('venueName')}
                  value={v.venueName}
                  onChange={set('venueName')}
                  error={err('venueName')}
                />
                <Input
                  id="wizard-city"
                  name="city"
                  maxLength={120}
                  label={t('city')}
                  value={v.city}
                  onChange={set('city')}
                  error={err('city')}
                />
              </>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <>
            {ticketing ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="pb-1 text-body font-medium">{t('firstPass')}</legend>
                <p className="text-caption text-zinc-500">{t('firstPassHint')}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    id="wizard-ticket-name"
                    name="ticketName"
                    maxLength={120}
                    label={t('ticketName')}
                    value={v.ticketName}
                    onChange={set('ticketName')}
                    error={err('ticketName')}
                  />
                  <Input
                    id="wizard-ticket-price"
                    name="ticketPrice"
                    inputMode="decimal"
                    label={t('ticketPrice', { currency })}
                    hint={t('ticketPriceHint')}
                    value={v.ticketPrice}
                    onChange={set('ticketPrice')}
                    error={err('ticketPrice')}
                  />
                  <Input
                    id="wizard-ticket-quantity"
                    name="ticketQuantity"
                    inputMode="numeric"
                    label={t('ticketQuantity')}
                    value={v.ticketQuantity}
                    onChange={set('ticketQuantity')}
                    error={err('ticketQuantity')}
                  />
                </div>
              </fieldset>
            ) : null}
            <section aria-labelledby="wizard-summary" className="flex flex-col gap-2">
              <h3 id="wizard-summary" className="text-body font-medium">
                {t('summary')}
              </h3>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-[max-content_1fr]">
                <dt className="text-caption text-zinc-600">{t('name')}</dt>
                <dd className="m-0">{v.name}</dd>
                <dt className="text-caption text-zinc-600">{t('when')}</dt>
                <dd className="m-0">
                  {v.startsAt.replace('T', ' ')} – {v.endsAt.replace('T', ' ')} (
                  {v.timezone.replace(/_/g, ' ')})
                </dd>
                <dt className="text-caption text-zinc-600">{t('where')}</dt>
                <dd className="m-0">
                  {[venue?.name ?? v.venueName, venue ? venue.city : v.city].filter(Boolean).join(', ') ||
                    tn(`publicEvent.mode.${v.attendanceMode as (typeof MODES)[number]}`)}
                </dd>
              </dl>
            </section>
            <section aria-labelledby="wizard-checklist" className="flex flex-col gap-2">
              <h3 id="wizard-checklist" className="text-body font-medium">
                {t('checklist')}
              </h3>
              <p className="text-caption text-zinc-500">{t('checklistHint')}</p>
              <ul className="flex list-none flex-col gap-1 p-0">
                {rules
                  .filter((r) => r.key !== 'datesUpcoming')
                  .map((r) => (
                    <li key={r.key} className="flex items-center gap-2.5 text-body">
                      <span
                        aria-hidden="true"
                        className={`flex size-[18px] items-center justify-center rounded-full ${r.done ? 'bg-green-500 text-white' : 'border border-zinc-300'}`}
                      >
                        {r.done ? <Check className="size-3" strokeWidth={2.5} /> : null}
                      </span>
                      {tn(`readiness.${r.key}`)}
                      <span className="sr-only">{r.done ? tn('readiness.done') : tn('readiness.todo')}</span>
                    </li>
                  ))}
              </ul>
            </section>
          </>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          {step > 0 ? (
            <Button type="button" variant="secondary" onClick={() => go(step - 1)} disabled={pending}>
              {t('back')}
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button type="submit">{t('next')}</Button>
          ) : (
            <Button type="submit" disabled={pending}>
              {t('create')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
