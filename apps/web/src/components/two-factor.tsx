'use client';

import { Alert, Button, buttonClass, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState, useTransition } from 'react';
import {
  beginSetupAction,
  type CodesState,
  confirmSetupAction,
  disableAction,
  regenerateCodesAction,
  type SecurityState,
  type SetupStart,
} from '@/app/[locale]/account/security/actions.ts';
import { Link, useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUp, useStepUpAction } from './step-up.tsx';

/** Localized text for the codes packages/auth answers with. */
function useCodeMessage() {
  const t = useTranslations('security.errors');
  const te = useTranslations();
  return (code: string | null) => {
    if (!code) return null;
    if (
      ['invalid_code', 'rate_limited', 'not_pending', 'required', 'already_enabled', 'not_enabled'].includes(
        code,
      )
    )
      return t(code);
    return te(errorMessageKey(code));
  };
}

/** Copies text; says so for screen readers too. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('security');
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard?.writeText(text).catch(() => undefined);
          setCopied(true);
        }}
      >
        {label}
      </Button>
      <span aria-live="polite" className="text-caption text-zinc-500">
        {copied ? t('copied') : ''}
      </span>
    </>
  );
}

/** Backup codes, shown once: a list, copy, and a .txt download. */
export function BackupCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  const t = useTranslations('security');
  const headingId = useId();
  const text = `${t('codesFileHeader')}\n\n${codes.join('\n')}\n`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-section">
        {t('codesTitle')}
      </h3>
      <p className="text-body text-zinc-600">{t('codesExplain')}</p>
      <ol
        aria-label={t('codesTitle')}
        className="grid list-none grid-cols-1 gap-2 rounded-card border border-zinc-200 bg-zinc-50 p-4 font-mono text-body sm:grid-cols-2"
      >
        {codes.map((c) => (
          <li key={c} dir="ltr" className="text-start">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={codes.join('\n')} label={t('copyCodes')} />
        <a
          download="yayatoh-backup-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          className={buttonClass('secondary', 'sm')}
        >
          {t('downloadCodes')}
        </a>
      </div>
      <Button className="self-start" onClick={onDone}>
        {t('codesSaved')}
      </Button>
    </section>
  );
}

/** Set up an authenticator app: QR code (with the setup key as its text alternative), then a code. */
export function TwoFactorSetup({ required }: { required: boolean }) {
  const t = useTranslations('security');
  const message = useCodeMessage();
  const router = useRouter();
  const stepUp = useStepUp();
  const [start, setStart] = useState<SetupStart | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<CodesState, FormData>(confirmSetupAction, {
    ok: false,
    code: null,
  });
  const keyId = useId();

  const begin = () =>
    startTransition(async () => {
      let r = await beginSetupAction();
      if (r.code === 'step_up_required' && (await stepUp.confirm())) r = await beginSetupAction();
      setStart(r);
    });

  if (state.ok && state.backupCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title={t('enabledNow')} />
        <BackupCodes codes={state.backupCodes} onDone={() => router.refresh()} />
        {required ? (
          <Link href="/o" className={buttonClass('ghost', 'md', 'self-start')}>
            {t('continueToConsole')}
          </Link>
        ) : null}
      </div>
    );
  }

  if (!start?.setupKey || !start.qr) {
    return (
      <div className="flex flex-col gap-3">
        {start?.code ? <Alert title={message(start.code) ?? ''} /> : null}
        <Button className="self-start" onClick={begin} disabled={starting}>
          {t('setUp')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-none flex-col gap-5 p-0">
        <li className="flex flex-col gap-3">
          <p className="text-body">{t('step1')}</p>
          <svg
            role="img"
            aria-label={t('qrLabel')}
            aria-describedby={keyId}
            viewBox={`0 0 ${start.qr.size} ${start.qr.size}`}
            shapeRendering="crispEdges"
            className="size-44 rounded-card border border-zinc-200 text-zinc-900"
          >
            <rect width={start.qr.size} height={start.qr.size} fill="white" />
            <path d={start.qr.d} fill="currentColor" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-zinc-600">{t('manualKeyLabel')}</p>
            <p className="flex flex-wrap items-center gap-2">
              <code
                id={keyId}
                dir="ltr"
                className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-body tracking-wide select-all"
              >
                {start.setupKey}
              </code>
              <CopyButton text={start.setupKey.replace(/ /g, '')} label={t('copyKey')} />
            </p>
          </div>
        </li>
        <li>
          <form action={formAction} className="flex flex-col gap-3" noValidate>
            <p className="text-body">{t('step2')}</p>
            <div aria-live="polite">{state.code ? <Alert title={message(state.code) ?? ''} /> : null}</div>
            <Input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              autoFocus
              label={t('codeLabel')}
              error={state.code === 'invalid_code' ? t('errors.invalid_code') : undefined}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {t('verify')}
              </Button>
              <Button variant="secondary" onClick={() => setStart(null)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        </li>
      </ol>
    </div>
  );
}

/** Turn two-step verification off: needs a current code (or a backup code). */
export function TwoFactorOff() {
  const t = useTranslations('security');
  const message = useCodeMessage();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SecurityState, FormData>(disableAction, {
    ok: false,
    code: null,
  });
  if (!open)
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {t('turnOff')}
      </Button>
    );
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <p className="text-body text-zinc-600">{t('turnOffExplain')}</p>
      <div aria-live="polite">{state.code ? <Alert title={message(state.code) ?? ''} /> : null}</div>
      <Input
        id="disable-code"
        name="code"
        autoComplete="one-time-code"
        required
        autoFocus
        label={t('currentCodeLabel')}
        error={state.code === 'invalid_code' ? t('errors.invalid_code') : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t('turnOffConfirm')}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Replace the backup codes (step-up first); the new ones are shown once. */
export function RegenerateCodes({ left }: { left: number }) {
  const t = useTranslations('security');
  const message = useCodeMessage();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { action, formRef } = useStepUpAction<CodesState>(regenerateCodesAction);
  const [state, formAction, pending] = useActionState<CodesState, FormData>(action, {
    ok: false,
    code: null,
  });
  if (state.ok && state.backupCodes)
    return <BackupCodes codes={state.backupCodes} onDone={() => router.refresh()} />;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <p className="text-body text-zinc-600">{t('codesLeft', { count: left })}</p>
      <div aria-live="polite">{state.code ? <Alert title={message(state.code) ?? ''} /> : null}</div>
      {confirming ? (
        <>
          <p className="text-body">{t('regenerateWarning')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {t('regenerateConfirm')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
          {t('regenerate')}
        </Button>
      )}
    </form>
  );
}
