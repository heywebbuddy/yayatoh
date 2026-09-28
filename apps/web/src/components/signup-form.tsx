'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import type { SignupState } from '@/app/[locale]/signup/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { HumanCheckField, type HumanCheckWidget } from './human-check-field.tsx';

const PROFILES = ['wedding', 'gala', 'concert', 'conference', 'community', 'agency', 'other'] as const;

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

/**
 * Create an organization: signup code (M1.3b; none in open signup, M3.11a), name and address,
 * the kind of events, the terms, and in open signup the "are you a person?" check.
 */
export function SignupForm({
  action,
  code,
  open = false,
  humanCheck = null,
}: {
  action: (prev: SignupState, form: FormData) => Promise<SignupState>;
  code: string;
  /** Open signup without a code: no code field. */
  open?: boolean;
  humanCheck?: HumanCheckWidget | null;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tz, setTz] = useState('');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const error =
    state.code === 'invalid_code'
      ? t('signup.invalidCode')
      : state.code === 'signup_closed'
        ? t('signup.closedNow')
        : state.code === 'email_unverified'
          ? t('signup.verifyEmail')
          : state.code === 'human_check'
            ? t('signup.humanCheck')
            : state.code === 'rate_limited'
              ? t('errors.rateLimitedRetry', { minutes: state.minutes ?? 60 })
              : state.code === 'conflict' && state.field === 'slug'
                ? t('signup.slugTaken')
                : state.code
                  ? t(errorMessageKey(state.code))
                  : null;
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="timezone" value={tz} />
      {open && !code ? (
        <input type="hidden" name="code" value="" />
      ) : (
        <Input
          name="code"
          required
          defaultValue={code}
          autoComplete="off"
          spellCheck={false}
          label={t('signup.code')}
        />
      )}
      <Input
        name="name"
        required
        maxLength={120}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        label={t('signup.orgName')}
      />
      <Input
        name="slug"
        required
        minLength={2}
        maxLength={63}
        pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        label={t('signup.slug')}
        hint={t('signup.slugHint', { slug: slug || '…' })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption text-zinc-600">{t('signup.profile')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PROFILES.map((p, i) => (
            <label
              key={p}
              className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-card border border-zinc-200 bg-white p-3 has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="profile"
                value={p}
                defaultChecked={i === 0}
                className="mt-0.5 size-5 accent-ink"
              />
              <span className="flex flex-col">
                <span className="text-body">{t(`profiles.${p}`)}</span>
                <span className="text-caption text-zinc-500">{t(`signup.profileHint.${p}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-6 items-start gap-2.5 text-body">
        <input
          type="checkbox"
          name="terms"
          value="yes"
          required
          className="mt-0.5 size-5 shrink-0 accent-ink"
        />
        <span>
          {t.rich('signup.terms', {
            tos: (chunks) => (
              <Link href="/legal/platform/platform_tos" className="underline" target="_blank">
                {chunks}
              </Link>
            ),
            dpa: (chunks) => (
              <Link href="/legal/platform/dpa" className="underline" target="_blank">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>
      {open && !code && humanCheck ? <HumanCheckField widget={humanCheck} /> : null}
      <div aria-live="polite">{error ? <Alert title={error} /> : null}</div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('signup.submit')}
      </Button>
    </form>
  );
}
