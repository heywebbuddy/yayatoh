'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import {
  type MethodState,
  revokeAllDevicesAction,
  revokeDeviceAction,
  startLinkAction,
  unlinkAction,
} from '@/app/[locale]/account/security/sign-in-actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUp, useStepUpActionState } from './step-up.tsx';

type Provider = 'google' | 'apple';

const KNOWN = [
  'not_linked',
  'last_method',
  'linked',
  'already_linked',
  'linked_elsewhere',
  'provider_taken',
  'failed',
  'cancelled',
  'unavailable',
  'unlinked',
] as const;

function useMessage() {
  const t = useTranslations('security.methods.messages');
  const te = useTranslations();
  return (code: string | null) =>
    code ? ((KNOWN as readonly string[]).includes(code) ? t(code) : te(errorMessageKey(code))) : null;
}

/**
 * Google and Apple on account security (M1.2f): linked or not, with "Link" (step-up, then the
 * provider) and "Unlink" (step-up). `result` is what the provider callback came back with.
 */
export function SignInMethods({
  providers,
  linked,
  result,
}: {
  providers: readonly Provider[];
  linked: readonly { provider: Provider; linkedAt: string }[];
  result: { code: string; provider: Provider } | null;
}) {
  const t = useTranslations('security.methods');
  const message = useMessage();
  const stepUp = useStepUp();
  const [starting, startTransition] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [state, unlink, unlinking, formRef] = useStepUpActionState<MethodState>(unlinkAction, {
    ok: false,
    code: null,
  });
  const link = (provider: Provider) =>
    startTransition(async () => {
      setLinkError(null);
      let r = await startLinkAction(provider);
      if (r.code === 'step_up_required' && (await stepUp.confirm())) r = await startLinkAction(provider);
      if (r.url) window.location.assign(r.url);
      else if (r.code && r.code !== 'step_up_required') setLinkError(r.code);
    });
  const shown = linkError ?? state.code ?? (result ? result.code : null);
  const good = shown === 'linked' || shown === 'unlinked' || shown === 'already_linked';
  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">
        {shown ? <Alert tone={good ? 'info' : undefined} title={message(shown) ?? ''} /> : null}
      </div>
      <ul className="flex list-none flex-col gap-3 p-0">
        {providers.map((p) => {
          const row = linked.find((l) => l.provider === p);
          return (
            <li
              key={p}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3"
            >
              <div className="flex flex-col">
                <span className="text-body">{t(`provider.${p}`)}</span>
                <span className="text-caption text-zinc-600">
                  {row ? t('linkedOn', { date: row.linkedAt }) : t('notLinked')}
                </span>
              </div>
              {row ? (
                <form ref={formRef} action={unlink}>
                  <input type="hidden" name="provider" value={p} />
                  <Button type="submit" variant="secondary" size="sm" disabled={unlinking}>
                    {t('unlink', { provider: t(`provider.${p}`) })}
                  </Button>
                </form>
              ) : (
                <Button variant="secondary" size="sm" disabled={starting} onClick={() => link(p)}>
                  {t('link', { provider: t(`provider.${p}`) })}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Trusted devices (M1.2f): which browsers skip the second step, and revoking them (dates preformatted). */
export function TrustedDevices({
  devices,
}: {
  devices: readonly {
    id: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string;
  }[];
}) {
  const t = useTranslations('security.devices');
  const [one, revokeOne, pendingOne] = useActionState<MethodState, FormData>(revokeDeviceAction, {
    ok: false,
    code: null,
  });
  const [all, revokeAll, pendingAll] = useActionState<MethodState, FormData>(revokeAllDevicesAction, {
    ok: false,
    code: null,
  });
  const done = all.code === 'revoked_all' ? t('revokedAll') : one.code === 'revoked' ? t('revoked') : null;
  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">{done ? <Alert tone="info" title={done} /> : null}</div>
      {devices.length === 0 ? (
        <p className="text-body text-zinc-600">{t('none')}</p>
      ) : (
        <>
          <ul className="flex list-none flex-col gap-3 p-0">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3"
              >
                <div className="flex flex-col">
                  <span className="text-body">{d.label}</span>
                  <span className="text-caption text-zinc-600">
                    {t('trustedOn', { date: d.createdAt })}
                    {' · '}
                    {d.lastUsedAt ? t('lastUsed', { date: d.lastUsedAt }) : t('neverUsed')}
                    {' · '}
                    {t('until', { date: d.expiresAt })}
                  </span>
                </div>
                <form action={revokeOne}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={pendingOne}
                    aria-label={t('revokeNamed', { device: d.label })}
                  >
                    {t('revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          <form action={revokeAll}>
            <Button type="submit" variant="ghost" size="sm" disabled={pendingAll}>
              {t('revokeAll')}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
