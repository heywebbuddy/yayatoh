'use client';

import { Alert, Button, buttonClass, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import {
  type DataExportState,
  type DeleteAccountState,
  deleteAccountAction,
  prepareExportAction,
} from '@/app/[locale]/account/security/data-actions.ts';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

/** Download my data (M1.14e): confirm it's you, then the JSON file downloads. */
export function AccountExport() {
  const t = useTranslations();
  const [state, action, pending, formRef] = useStepUpActionState<DataExportState>(prepareExportAction, {
    ok: false,
    code: null,
  });
  return (
    <Card role="region" aria-labelledby="data-heading" className="flex flex-col gap-3">
      <h2 id="data-heading" className="text-section">
        {t('security.data.title')}
      </h2>
      <p className="text-body text-zinc-600">{t('security.data.explain')}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-zinc-600">
        <li>{t('security.data.includes')}</li>
        <li>{t('security.data.excludes')}</li>
      </ul>
      <form ref={formRef} action={action}>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('security.data.prepare')}
        </Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? (
          <>
            <p className="text-body">{t('security.data.ready')}</p>
            <a href="/api/account/export" download className={buttonClass('primary', 'sm', 'self-start')}>
              {t('security.data.download')}
            </a>
          </>
        ) : state.code ? (
          <Alert title={t(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Delete my account (M1.14e). Hidden while the person is the only owner of an organization (the
 * server refuses it too, naming the organizations); otherwise the email must be typed again and a
 * step-up confirmed.
 */
export function AccountDelete({ email, blockers }: { email: string; blockers: readonly string[] }) {
  const t = useTranslations();
  const [state, action, pending, formRef] = useStepUpActionState<DeleteAccountState>(deleteAccountAction, {
    code: null,
  });
  const orgs = state.code === 'last_owner' ? (state.orgs ?? []) : blockers;
  const fieldError =
    state.code === 'confirm_required'
      ? t('security.delete.confirmRequired')
      : state.code === 'confirm_mismatch'
        ? t('security.delete.confirmMismatch')
        : undefined;
  return (
    <Card role="region" aria-labelledby="delete-heading" className="flex flex-col gap-3 border-pink-700">
      <h2 id="delete-heading" className="text-section">
        {t('security.delete.title')}
      </h2>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-zinc-600">
        <li>{t('security.delete.signOut')}</li>
        <li>{t('security.delete.teams')}</li>
        <li>{t('security.delete.orders')}</li>
        <li>{t('security.delete.final')}</li>
      </ul>
      {orgs.length > 0 ? (
        <div aria-live="polite">
          <Alert title={t('security.delete.blockedTitle')}>
            <p>{t('security.delete.blockedExplain', { count: orgs.length })}</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 ps-5">
              {orgs.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
      {blockers.length === 0 ? (
        <form ref={formRef} action={action} className="flex flex-col gap-3" noValidate>
          <Input
            id="delete-confirm"
            name="confirm"
            type="email"
            autoComplete="off"
            required
            maxLength={320}
            label={t('security.delete.confirmLabel', { email })}
            error={fieldError}
          />
          <Button type="submit" disabled={pending} className="self-start">
            {t('security.delete.submit')}
          </Button>
          <div aria-live="polite">
            {state.code && !fieldError && state.code !== 'last_owner' ? (
              <Alert title={t(errorMessageKey(state.code))} />
            ) : null}
          </div>
        </form>
      ) : null}
    </Card>
  );
}
