'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export type GuestCodeStatus = 'sent' | 'cooldown' | 'wrong' | 'locked' | 'expired' | 'used';

/** Seconds until `at` (epoch ms), ticking once a second; 0 when past or unknown. */
function useSecondsUntil(at: number | null | undefined): number {
  const left = () => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!at) return;
    const id = setInterval(() => {
      const s = left();
      setSeconds(s);
      if (s === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [at]);
  return seconds;
}

/**
 * The "enter the code we emailed" step (M1.5f), shared by checkout and My tickets: a one-time-code
 * field, the submit button, "Send a new code" (disabled through the cooldown, with a countdown)
 * and the outcome of the last attempt, announced politely. Lives inside the caller's form; the
 * resend button posts `verifyIntent=resend` and skips validation.
 */
export function GuestCodeFields({
  email,
  status,
  attemptsLeft,
  resendAt,
  submitLabel,
  pending,
  idPrefix,
}: {
  email: string;
  status: GuestCodeStatus;
  attemptsLeft?: number | null;
  resendAt?: number | null;
  submitLabel: string;
  pending: boolean;
  idPrefix: string;
}) {
  const t = useTranslations('guestVerify');
  // A cooldown answer keeps the last known time when none came back.
  const [until, setUntil] = useState<number | null>(resendAt ?? null);
  useEffect(() => {
    if (resendAt) setUntil(resendAt);
  }, [resendAt]);
  const seconds = useSecondsUntil(until);
  // Focus moves to the code when the step appears and after each attempt, so keyboard and
  // screen-reader users land on it (and hear its error).
  useEffect(() => {
    document.getElementById(`${idPrefix}-code`)?.focus();
  }, [status, attemptsLeft, idPrefix]);
  const failed = status === 'wrong' || status === 'locked' || status === 'expired' || status === 'used';
  const message =
    status === 'wrong'
      ? t('wrong', { count: attemptsLeft ?? 0 })
      : status === 'locked'
        ? t('locked')
        : status === 'expired' || status === 'used'
          ? t('expired')
          : status === 'cooldown'
            ? t('cooldown')
            : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{t('sent', { email })}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-56">
          <Input
            // A new outcome clears the field for the next try.
            key={`${status}-${attemptsLeft ?? ''}`}
            id={`${idPrefix}-code`}
            name="verifyCode"
            label={t('codeLabel')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            error={failed && message ? message : undefined}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        <Button
          type="submit"
          name="verifyIntent"
          value="resend"
          variant="secondary"
          formNoValidate
          disabled={pending || seconds > 0}
        >
          {t('resend')}
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {seconds > 0 ? <p className="text-caption text-ink-2">{t('resendIn', { seconds })}</p> : null}
        {status === 'cooldown' && message ? <Alert tone="info" title={message} /> : null}
      </div>
    </div>
  );
}
