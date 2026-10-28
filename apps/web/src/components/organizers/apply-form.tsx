'use client';

import {
  EVENT_TYPES,
  EVENTS_PER_YEAR,
  EXPECTED_TICKETS,
  ORG_TYPES,
  PLAN_INTERESTS,
} from '@yayatoh/applications/options';
import { Alert, Button, Checkbox, DateTimePicker, Input, Radio, Select, Textarea } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** ISO 3166-1 countries and territories we take applications from (names come from Intl). */
const COUNTRIES =
  'AE AR AT AU BD BE BR CA CH CL CN CO CZ DE DK EG ES FI FR GB GH GR HK HU ID IE IL IN IT JP KE KR LK MX MY NG NL NO NP NZ PE PH PK PL PT QA RO SA SE SG TH TR TW TZ UA UG US VN ZA'.split(
    ' ',
  );

/**
 * The "Apply / Book a demo" form of the organizer landing page. One form, two modes: a demo asks
 * for a preferred time. Field errors sit beside their fields; the confirmation replaces the form
 * and takes focus. Selections the server rejected stay (keepValues).
 */
export function ApplyForm({
  action,
  humanCheck,
  initialMode,
  initialPlan,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  humanCheck: HumanCheckWidget | null;
  initialMode: 'apply' | 'demo';
  initialPlan: string;
}) {
  const t = useTranslations('forOrganizers.form');
  const to = useTranslations('forOrganizers');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [mode, setMode] = useState(initialMode);
  const [tz, setTz] = useState({ name: '', offset: '0' });
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTz({
      name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: String(new Date().getTimezoneOffset()),
    });
  }, []);
  useEffect(() => {
    if (state.ok) done.current?.focus();
  }, [state.ok]);
  const countries = (() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return COUNTRIES.map((c) => ({ value: c, label: names.of(c) ?? c, text: names.of(c) ?? c })).sort(
      (a, b) => a.text.localeCompare(b.text, locale),
    );
  })();
  if (state.ok)
    return (
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6"
      >
        <p className="m-0 font-display text-section font-black">{t('sentTitle')}</p>
        <p className="m-0 text-body text-ink-2">{t(mode === 'demo' ? 'sentDemo' : 'sentApply')}</p>
      </div>
    );
  const bad = new Set(state.fields ?? []);
  const err = (f: string) => (bad.has(f) ? t(`errors.${f}`) : undefined);
  const opts = (group: string, keys: readonly string[]) =>
    keys.map((k) => ({ value: k, label: to(`options.${group}.${k}`), text: to(`options.${group}.${k}`) }));
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} noValidate className="flex flex-col gap-5">
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{t('mode')}</legend>
        {(['apply', 'demo'] as const).map((m) => (
          <Radio
            key={m}
            name="kind"
            value={m}
            checked={mode === m}
            onChange={() => setMode(m)}
            label={t(`mode_${m}`)}
          />
        ))}
      </fieldset>
      <input type="hidden" name="timezone" value={tz.name} />
      <input type="hidden" name="tzOffset" value={tz.offset} />
      {/* Honeypot: people never see or fill this. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <input name="fax" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          name="orgName"
          required
          maxLength={160}
          autoComplete="organization"
          label={t('orgName')}
          error={err('orgName')}
        />
        <Select
          name="orgType"
          label={t('orgType')}
          defaultValue="company"
          options={opts('orgType', ORG_TYPES)}
        />
        <Select
          name="country"
          label={t('country')}
          defaultValue=""
          placeholder={t('countryPlaceholder')}
          searchable
          options={countries}
          error={err('country')}
        />
        <Input
          name="website"
          type="url"
          inputMode="url"
          maxLength={200}
          dir="ltr"
          label={t('website')}
          hint={t('optional')}
          error={err('website')}
        />
        <Input
          name="contactName"
          required
          maxLength={120}
          autoComplete="name"
          label={t('contactName')}
          error={err('contactName')}
        />
        <Input
          name="contactEmail"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          dir="ltr"
          label={t('contactEmail')}
          error={err('contactEmail')}
        />
        <Input
          name="contactPhone"
          type="tel"
          maxLength={40}
          autoComplete="tel"
          dir="ltr"
          label={t('contactPhone')}
          hint={t('optional')}
        />
        <Select
          name="eventsPerYear"
          label={t('eventsPerYear')}
          defaultValue="1-5"
          options={opts('eventsPerYear', EVENTS_PER_YEAR)}
        />
        <Select
          name="expectedTickets"
          label={t('expectedTickets')}
          defaultValue="lt500"
          options={opts('expectedTickets', EXPECTED_TICKETS)}
        />
        <Select
          name="planInterest"
          label={t('planInterest')}
          defaultValue={initialPlan}
          options={opts('plan', PLAN_INTERESTS)}
        />
      </div>
      <fieldset
        className="m-0 flex flex-col gap-2 border-0 p-0"
        aria-describedby={bad.has('eventTypes') ? 'ev-err' : undefined}
      >
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('eventTypes')}</legend>
        <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-4">
          {EVENT_TYPES.map((k) => (
            <Checkbox key={k} name="eventTypes" value={k} label={to(`options.eventType.${k}`)} />
          ))}
        </div>
        {bad.has('eventTypes') ? (
          <p id="ev-err" className="m-0 text-caption text-danger">
            {t('errors.eventTypes')}
          </p>
        ) : null}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('whiteLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          <Radio name="whiteLabel" value="no" defaultChecked label={t('no')} />
          <Radio name="whiteLabel" value="yes" label={t('yes')} />
        </div>
      </fieldset>
      {mode === 'demo' ? (
        <DateTimePicker
          name="preferredTime"
          required
          label={t('preferredTime')}
          hint={tz.name ? t('preferredTimeHint', { zone: tz.name }) : undefined}
          error={err('preferredTime')}
        />
      ) : null}
      <Textarea name="message" rows={4} maxLength={2000} label={t('message')} hint={t('optional')} />
      {humanCheck ? (
        <div className="flex flex-col gap-1.5">
          <HumanCheckField widget={humanCheck} />
          {bad.has('human') ? <p className="m-0 text-caption text-danger">{t('errors.human')}</p> : null}
        </div>
      ) : null}
      <p className="m-0 text-caption text-ink-2">{t('privacy')}</p>
      <div aria-live="polite">
        {state.code === 'rate_limited' ? (
          <Alert title={t('rateLimited', { minutes: Number(state.reason ?? 1) })} />
        ) : state.code ? (
          <Alert title={t('fixErrors')} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t(mode === 'demo' ? 'submitDemo' : 'submitApply')}
      </Button>
    </form>
  );
}
