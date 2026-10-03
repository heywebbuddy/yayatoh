'use client';

import { isKioskCodeShape, isKioskEmail, KIOSK_DONE_MS, KIOSK_IDLE_MS } from '@yayatoh/badges/client';
import { Alert, Button, buttonClass, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KioskBadge, KioskPrintResult, ScanClient } from '@/scan/client.ts';

/** How the attendee started: by scanning their ticket (already checked in by the scan), or by email. */
export type SelfPrintStart =
  | { readonly kind: 'scan'; readonly code: string; readonly ticketId: string | null }
  | { readonly kind: 'email' };

type Step =
  | { s: 'loading' }
  | { s: 'email'; error?: string }
  | { s: 'code'; challengeId: string; email: string; error?: string }
  | { s: 'details'; badge: KioskBadge; code: string | null }
  | { s: 'done'; message: 'printing' | 'ready' | 'queued' }
  | {
      s: 'desk';
      why: 'desk' | 'printed' | 'notFound' | 'wrongDetails' | 'printFailed' | 'locked' | 'offline';
    };

const BIG = 'min-h-16 min-w-48 text-title';

/**
 * Kiosk self-print (M5.5c): one attendee at a time. They identify by their ticket's code (the scan
 * that checked them in) or by a code emailed to the ticket's holder, check what their badge will
 * say, and print it once. Nothing about them stays on screen: "Done", a finished print and a
 * minute without a touch all end the visit (`onDone` unmounts this panel).
 */
export function KioskSelfPrint({
  client,
  start,
  onDone,
  onCheckIn,
}: {
  client: ScanClient;
  start: SelfPrintStart;
  onDone: () => void;
  /** Email path: check the attendee in with their ticket's code once identified. */
  onCheckIn: (code: string) => Promise<void>;
}) {
  const t = useTranslations('kioskPrint');
  const locale = useLocale();
  const [step, setStep] = useState<Step>(start.kind === 'email' ? { s: 'email' } : { s: 'loading' });
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // A minute without a touch ends the visit; a finished print or a desk message after a few seconds.
  const [touched, setTouched] = useState(0);
  const touch = useCallback(() => setTouched((n) => n + 1), []);
  const finished = step.s === 'done' || step.s === 'desk';
  useEffect(() => {
    const id = window.setTimeout(onDone, finished ? KIOSK_DONE_MS : KIOSK_IDLE_MS);
    return () => window.clearTimeout(id);
  }, [finished, onDone, touched]);
  useEffect(() => () => (pdfUrl ? URL.revokeObjectURL(pdfUrl) : undefined), [pdfUrl]);

  // Each new step is announced: focus its heading (or its field, where one waits for typing).
  useEffect(() => {
    if (step.s === 'email') document.getElementById('kiosk-email')?.focus();
    else if (step.s === 'code') document.getElementById('kiosk-email-code')?.focus();
    else heading.current?.focus();
  }, [step]);

  // Scan path: the badge of the ticket just scanned.
  useEffect(() => {
    if (start.kind !== 'scan') return;
    void (async () => {
      const b = await client.kioskBadgeFor(start.code, start.ticketId);
      if (!b || 'code' in b) setStep({ s: 'desk', why: 'notFound' });
      else showBadge(b, start.code);
    })();
  }, []);

  function showBadge(badge: KioskBadge, code: string | null) {
    if (badge.status === 'printed') setStep({ s: 'desk', why: 'printed' });
    else if (badge.status === 'desk') setStep({ s: 'desk', why: 'desk' });
    else setStep({ s: 'details', badge, code });
  }

  async function sendEmail(email: string) {
    if (!isKioskEmail(email)) {
      setStep({ s: 'email', error: t('emailInvalid') });
      return;
    }
    setBusy(true);
    const r = await client.kioskEmailCode(email.trim(), locale);
    setBusy(false);
    if ('challengeId' in r) setStep({ s: 'code', challengeId: r.challengeId, email: email.trim() });
    else
      setStep({
        s: 'email',
        error: t(
          r.code === 'offline' ? 'emailOffline' : r.code === 'rate_limited' ? 'emailLimited' : 'emailFailed',
        ),
      });
  }

  async function verify(challengeId: string, email: string, code: string) {
    if (!isKioskCodeShape(code)) {
      setStep({ s: 'code', challengeId, email, error: t('codeInvalid') });
      return;
    }
    setBusy(true);
    const r = await client.kioskVerifyCode(challengeId, code);
    setBusy(false);
    if (r.status === 'ok') {
      await onCheckIn(r.checkInCode);
      showBadge(r.badge, null);
    } else if (r.status === 'desk') setStep({ s: 'desk', why: 'desk' });
    else if (r.status === 'locked') setStep({ s: 'desk', why: 'locked' });
    else
      setStep({
        s: 'code',
        challengeId,
        email,
        error:
          r.status === 'wrong'
            ? t('codeWrong', { left: r.attemptsLeft })
            : r.status === 'expired'
              ? t('codeExpired')
              : t('emailOffline'),
      });
  }

  async function print(badge: KioskBadge, code: string | null) {
    setBusy(true);
    const r: KioskPrintResult = await client.kioskPrintBadge({
      ticketId: badge.ticketId,
      ...(badge.pass ? { pass: badge.pass } : {}),
      ...(code ? { code } : {}),
      locale,
    });
    // The kiosk's own print dialog (P5-2 stage 1): the badge PDF, opened by the attendee to print.
    let pdf: Blob | null = null;
    if (r.status === 'printing' && r.adapter === 'browser' && r.pdfToken)
      pdf = await client.kioskBadgePdf(r.pdfToken);
    setBusy(false);
    if (r.status === 'printing') {
      if (r.failed || (r.adapter === 'browser' && !pdf)) setStep({ s: 'desk', why: 'printFailed' });
      else if (pdf) {
        setPdfUrl(URL.createObjectURL(pdf));
        setStep({ s: 'done', message: 'ready' });
      } else setStep({ s: 'done', message: 'printing' });
    } else if (r.status === 'queued') setStep({ s: 'done', message: 'queued' });
    else if (r.status === 'printed') setStep({ s: 'desk', why: 'printed' });
    else if (r.status === 'desk') setStep({ s: 'desk', why: 'desk' });
    else
      setStep({ s: 'desk', why: r.status === 'error' && r.code === 'offline' ? 'offline' : 'printFailed' });
  }

  return (
    <section
      aria-labelledby="kiosk-print-heading"
      data-kiosk-print={step.s}
      className="flex flex-col gap-6 rounded-panel border-2 border-line-strong bg-surface px-6 py-8"
      onPointerDown={touch}
      onKeyDown={touch}
    >
      {step.s === 'loading' ? (
        <h2 id="kiosk-print-heading" ref={heading} tabIndex={-1} className="text-display" aria-busy="true">
          {t('loading')}
        </h2>
      ) : null}

      {step.s === 'email' ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void sendEmail(String(new FormData(e.currentTarget).get('email') ?? ''));
          }}
        >
          <h2 id="kiosk-print-heading" ref={heading} tabIndex={-1} className="text-display">
            {t('emailTitle')}
          </h2>
          <p className="text-title text-ink-2">{t('emailHint')}</p>
          <Input
            id="kiosk-email"
            name="email"
            type="email"
            label={t('emailLabel')}
            autoComplete="off"
            inputMode="email"
            spellCheck={false}
            fieldSize="lg"
            error={step.error}
            required
          />
          <div className="flex flex-wrap gap-4">
            <Button type="submit" size="lg" className={BIG} disabled={busy}>
              {t('sendCode')}
            </Button>
            <Button type="button" variant="secondary" size="lg" className={BIG} onClick={onDone}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {step.s === 'code' ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void verify(
              step.challengeId,
              step.email,
              String(new FormData(e.currentTarget).get('code') ?? ''),
            );
          }}
        >
          <h2 id="kiosk-print-heading" ref={heading} tabIndex={-1} className="text-display">
            {t('codeTitle')}
          </h2>
          <p role="status" className="text-title text-ink-2">
            {t('codeSent', { email: step.email })}
          </p>
          <Input
            id="kiosk-email-code"
            name="code"
            label={t('codeLabel')}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            fieldSize="lg"
            className="font-mono tracking-[0.2em]"
            error={step.error}
            required
          />
          <div className="flex flex-wrap gap-4">
            <Button type="submit" size="lg" className={BIG} disabled={busy}>
              {t('confirmCode')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className={BIG}
              onClick={() => setStep({ s: 'email' })}
            >
              {t('newCode')}
            </Button>
            <Button type="button" variant="ghost" size="lg" className={BIG} onClick={onDone}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {step.s === 'details' ? (
        <>
          <h2 id="kiosk-print-heading" ref={heading} tabIndex={-1} className="text-display">
            {t('detailsTitle')}
          </h2>
          <p className="text-title text-ink-2">{t('detailsHint')}</p>
          <dl className="grid gap-x-6 gap-y-3 text-title sm:grid-cols-[max-content_1fr]">
            <dt className="text-ink-2">{t('name')}</dt>
            <dd className="m-0 font-bold" data-kiosk-name>
              {step.badge.name}
            </dd>
            {step.badge.company ? (
              <>
                <dt className="text-ink-2">{t('company')}</dt>
                <dd className="m-0">{step.badge.company}</dd>
              </>
            ) : null}
            {step.badge.jobTitle ? (
              <>
                <dt className="text-ink-2">{t('jobTitle')}</dt>
                <dd className="m-0">{step.badge.jobTitle}</dd>
              </>
            ) : null}
            <dt className="text-ink-2">{t('ticket')}</dt>
            <dd className="m-0">{step.badge.typeName}</dd>
          </dl>
          <div className="flex flex-wrap gap-4">
            <Button
              type="button"
              size="lg"
              className={BIG}
              disabled={busy}
              onClick={() => void print(step.badge, step.code)}
            >
              {busy ? t('printing') : t('print')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className={BIG}
              onClick={() => setStep({ s: 'desk', why: 'wrongDetails' })}
            >
              {t('wrongDetails')}
            </Button>
            <Button type="button" variant="ghost" size="lg" className={BIG} onClick={onDone}>
              {t('notMe')}
            </Button>
          </div>
        </>
      ) : null}

      {step.s === 'done' ? (
        <div role="status" className="flex flex-col gap-4">
          <h2
            id="kiosk-print-heading"
            ref={heading}
            tabIndex={-1}
            className="text-display text-success"
            data-kiosk-done={step.message}
          >
            {t(`${step.message}Title`)}
          </h2>
          <p className="text-title">{t(`${step.message}Hint`)}</p>
          <div className="flex flex-wrap gap-4">
            {step.message === 'ready' && pdfUrl ? (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener"
                className={`${buttonClass('primary', 'lg')} ${BIG}`}
                data-kiosk-pdf
                onClick={touch}
              >
                {t('openBadge')}
              </a>
            ) : null}
            <Button
              type="button"
              variant={step.message === 'ready' ? 'secondary' : 'primary'}
              size="lg"
              className={BIG}
              onClick={onDone}
            >
              {t('done')}
            </Button>
          </div>
        </div>
      ) : null}

      {step.s === 'desk' ? (
        <div className="flex flex-col gap-4">
          <h2 id="kiosk-print-heading" ref={heading} tabIndex={-1} className="text-display">
            {t('deskTitle')}
          </h2>
          <Alert tone={step.why === 'wrongDetails' ? 'info' : 'warning'} title={t(`desk.${step.why}`)} />
          <Button type="button" size="lg" className={`${BIG} self-start`} onClick={onDone}>
            {t('done')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
