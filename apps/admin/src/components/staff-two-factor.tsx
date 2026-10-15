'use client';

import type { StepUpMethod } from '@yayatoh/auth';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import type { StaffTwoFactorState } from '@/app/security/actions.ts';

/**
 * The staff member's own authenticator app: set it up, show it again for another phone, replace
 * the backup codes, or turn it off. Each change asks for a code or the password in the same form.
 */
export function StaffTwoFactor({
  action,
  enabled,
  backupCodesLeft,
  method,
}: {
  action: (prev: StaffTwoFactorState, form: FormData) => Promise<StaffTwoFactorState>;
  enabled: boolean;
  backupCodesLeft: number;
  method: StepUpMethod;
}) {
  const t = useTranslations('staffTwoFactor');
  const router = useRouter();
  const [state, run, pending] = useActionState(action, { kind: 'idle' });
  const message = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.internal'));

  if (state.kind === 'key')
    return (
      <div className="flex flex-col gap-3" data-testid="staff-two-factor-key">
        <p className="text-body">{state.purpose === 'setup' ? t('scan') : t('scanDevice')}</p>
        <svg
          role="img"
          aria-label={t('qrLabel')}
          viewBox={`0 0 ${state.qr.size} ${state.qr.size}`}
          shapeRendering="crispEdges"
          className="size-44 rounded-card border border-line text-ink"
        >
          <rect width={state.qr.size} height={state.qr.size} fill="white" />
          <path d={state.qr.d} fill="currentColor" />
        </svg>
        <p className="text-caption text-ink-2">{t('manualKey')}</p>
        <code
          dir="ltr"
          data-testid="staff-setup-key"
          className="self-start rounded-tag bg-surface-3 px-2 py-1 font-mono text-body tracking-wide select-all"
        >
          {state.setupKey}
        </code>
        {state.purpose === 'setup' ? (
          <CodeForm run={run} pending={pending} intent="verify" label={t('verify')} />
        ) : (
          <Button type="button" variant="secondary" className="self-start" onClick={() => router.refresh()}>
            {t('done')}
          </Button>
        )}
      </div>
    );

  if (state.kind === 'codes')
    return (
      <div className="flex flex-col gap-3" data-testid="staff-backup-codes">
        <Alert tone="info" title={t('codesTitle')} />
        <p className="text-body">{t('codesHint')}</p>
        <ul className="grid list-none grid-cols-2 gap-2 p-0 font-mono text-body sm:grid-cols-5" dir="ltr">
          {state.backupCodes.map((c) => (
            <li key={c} className="rounded-tag bg-surface-3 px-2 py-1 select-all">
              {c}
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" className="self-start" onClick={() => router.refresh()}>
          {t('done')}
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {state.kind === 'error' ? <Alert title={message(state.code)} /> : null}
        {state.kind === 'off' ? <Alert tone="info" title={t('turnedOff')} /> : null}
      </div>
      <p className="text-body" data-testid="staff-two-factor-status">
        {enabled ? t('on', { count: backupCodesLeft }) : t('off')}
      </p>
      {!enabled ? (
        <ProofForm run={run} pending={pending} method={method} intent="setup" label={t('setUp')} />
      ) : (
        <>
          <section className="flex flex-col gap-2 border-t border-line pt-3">
            <h3 className="text-body font-medium">{t('deviceTitle')}</h3>
            <p className="text-body text-ink-2">{t('deviceHint')}</p>
            <ProofForm run={run} pending={pending} method={method} intent="device" label={t('device')} />
          </section>
          <section className="flex flex-col gap-2 border-t border-line pt-3">
            <h3 className="text-body font-medium">{t('codesSection')}</h3>
            <ProofForm run={run} pending={pending} method={method} intent="codes" label={t('newCodes')} />
          </section>
          <section className="flex flex-col gap-2 border-t border-line pt-3">
            <h3 className="text-body font-medium">{t('offTitle')}</h3>
            <p className="text-body text-ink-2">{t('offHint')}</p>
            <CodeForm run={run} pending={pending} intent="off" label={t('turnOff')} backup />
          </section>
        </>
      )}
    </div>
  );
}

/** A form confirmed with the staff member's authenticator code, else their password. */
function ProofForm({
  run,
  pending,
  method,
  intent,
  label,
}: {
  run: (form: FormData) => void;
  pending: boolean;
  method: StepUpMethod;
  intent: string;
  label: string;
}) {
  const t = useTranslations('staffTwoFactor');
  const id = useId();
  if (method === 'email') return <p className="text-caption text-ink-2">{t('errors.two_factor_method')}</p>;
  return (
    <form action={run} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="intent" value={intent} />
      {method === 'totp' ? (
        <Input
          id={id}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          label={t('code')}
        />
      ) : (
        <Input
          id={id}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          label={t('password')}
        />
      )}
      <Button type="submit" variant="secondary" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

/** A form with an authenticator code (or a backup code, for turning it off). */
function CodeForm({
  run,
  pending,
  intent,
  label,
  backup,
}: {
  run: (form: FormData) => void;
  pending: boolean;
  intent: string;
  label: string;
  backup?: boolean;
}) {
  const t = useTranslations('staffTwoFactor');
  const id = useId();
  return (
    <form action={run} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="intent" value={intent} />
      <Input
        id={id}
        name="code"
        inputMode={backup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        required
        label={backup ? t('codeOrBackup') : t('code')}
      />
      <Button type="submit" variant={backup ? 'primary' : 'secondary'} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}
