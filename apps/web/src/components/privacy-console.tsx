'use client';

import { Alert, Button, Card, EmptyState, Input, Radio } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import type { FindState, OpenState } from '@/app/[locale]/o/[org]/(org)/privacy/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Module keys with a label (`privacy.modules.*`); others show their key. */
export const PRIVACY_MODULES = [
  'crm',
  'orders',
  'ticketing',
  'attendees',
  'forms',
  'checkin',
  'tenancy',
  'notifications',
  'seating',
  'alerts',
  'guests',
  'messaging',
  'assistance',
  'program',
  'events',
  'media',
  'cms',
  'venues',
  'reviews',
  'payments',
  'surveys',
  'registration',
  'badges',
  'automations',
  'campaigns',
  'audiences',
  'marketing',
  'reports',
  'privacy',
  'platform',
] as const;

export function useModuleLabel() {
  const t = useTranslations('privacy.modules');
  return (m: string) => ((PRIVACY_MODULES as readonly string[]).includes(m) ? t(m) : m);
}

export function usePrivacyError() {
  const t = useTranslations();
  return (code: string) =>
    code === 'invalid_email'
      ? t('privacy.errors.invalidEmail')
      : code === 'confirm_mismatch'
        ? t('privacy.errors.confirmMismatch')
        : code === 'kind_required'
          ? t('privacy.errors.kindRequired')
          : code === 'reason_required'
            ? t('privacy.errors.reasonRequired')
            : code === 'invalid_state'
              ? t('privacy.errors.closed')
              : t(errorMessageKey(code));
}

/**
 * Data-subject requests (M1.14c, M6.1c): find a person by email across every module, then open
 * an access or erasure request for them (one open request per person). Emails travel in POST
 * bodies only, never in a URL.
 */
export function PrivacyConsole({
  find,
  open,
  org,
}: {
  find: (prev: FindState, form: FormData) => Promise<FindState>;
  open: (prev: OpenState, form: FormData) => Promise<OpenState>;
  org: string;
}) {
  const t = useTranslations();
  const label = useModuleLabel();
  const message = usePrivacyError();
  const [found, findAction, finding] = useActionState(find, { kind: 'idle' });
  const [opened, openAction, opening] = useActionState(open, { kind: 'idle' });
  const kindId = useId();
  const current = found.kind === 'found' ? found : null;
  const rows = current ? Object.entries(current.summary).filter(([, n]) => n > 0) : [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('privacy.find.title')}</h2>
        <p className="text-body text-ink-2">{t('privacy.find.hint')}</p>
        <form action={findAction} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
          <div className="flex-1">
            <Input
              name="email"
              type="email"
              autoComplete="off"
              required
              maxLength={320}
              label={t('privacy.find.email')}
              error={found.kind === 'error' ? message(found.code) : undefined}
            />
          </div>
          <Button type="submit" disabled={finding} className="sm:mt-[22px]">
            {t('privacy.find.submit')}
          </Button>
        </form>
      </Card>

      {current ? (
        <section aria-labelledby="dsar-result" className="flex flex-col gap-4" aria-live="polite">
          {current.found ? (
            <Card className="flex flex-col gap-3">
              <h2 id="dsar-result" className="text-section">
                {t('privacy.result.title', { email: current.email })}
              </h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="dsar-summary">
                {rows.map(([m, n]) => (
                  <div
                    key={m}
                    className="flex items-baseline justify-between gap-3 border-b border-line py-1"
                  >
                    <dt className="text-body text-ink-2">{label(m)}</dt>
                    <dd className="font-mono text-body">{n}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <EmptyState
              title={t('privacy.result.noneTitle')}
              description={t('privacy.result.noneDescription')}
            />
          )}
          {current.openRequestId ? (
            <Alert tone="info" title={t('privacy.open.existing')}>
              <Link
                href={`/o/${org}/privacy/requests/${current.openRequestId}`}
                className="inline-flex min-h-6 items-center underline underline-offset-2"
              >
                {t('privacy.open.review')}
              </Link>
            </Alert>
          ) : (
            <Card className="flex flex-col gap-3">
              <h2 className="text-section">{t('privacy.open.title')}</h2>
              <p className="text-body text-ink-2">{t('privacy.open.hint')}</p>
              <form action={openAction} className="flex flex-col gap-3" noValidate>
                <input type="hidden" name="email" value={current.email} />
                <fieldset
                  className="flex flex-col"
                  aria-describedby={opened.kind === 'error' ? `${kindId}-error` : undefined}
                >
                  <legend className="text-body font-semibold">{t('privacy.open.kind')}</legend>
                  <Radio
                    id={`${kindId}-access`}
                    name="kind"
                    value="access"
                    label={t('privacy.open.access')}
                    hint={t('privacy.open.accessHint')}
                  />
                  <Radio
                    id={`${kindId}-erasure`}
                    name="kind"
                    value="erasure"
                    label={t('privacy.open.erasure')}
                    hint={t('privacy.open.erasureHint')}
                  />
                </fieldset>
                {opened.kind === 'error' ? (
                  <p id={`${kindId}-error`} role="alert" className="text-body text-danger">
                    {message(opened.code)}
                  </p>
                ) : null}
                <Button type="submit" disabled={opening} className="self-start">
                  {t('privacy.open.submit')}
                </Button>
              </form>
            </Card>
          )}
        </section>
      ) : null}
    </div>
  );
}
