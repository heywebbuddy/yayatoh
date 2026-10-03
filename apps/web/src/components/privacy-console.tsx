'use client';

import { Alert, Button, buttonClass, Card, EmptyState, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import type { EraseState, ExportState, FindState } from '@/app/[locale]/o/[org]/(org)/privacy/actions.ts';
import { useStepUpActionState } from '@/components/step-up.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

const CATEGORIES = [
  'contacts',
  'consents',
  'orders',
  'paidOrders',
  'tickets',
  'activeTickets',
  'claims',
  'holderLinks',
  'attendees',
  'answers',
  'admissions',
  'invitations',
  'networkProfiles',
  'chatMessages',
] as const;

/**
 * Data-subject requests (M1.14c): find a person by email, export their data, erase them. Emails
 * travel in POST bodies only (never in a URL). Erasure needs the address typed again.
 */
export function PrivacyConsole({
  find,
  exportData,
  erase,
  downloadBase,
}: {
  find: (prev: FindState, form: FormData) => Promise<FindState>;
  exportData: (prev: ExportState, form: FormData) => Promise<ExportState>;
  erase: (prev: EraseState, form: FormData) => Promise<EraseState>;
  downloadBase: string;
}) {
  const t = useTranslations();
  const [found, findAction, finding] = useActionState(find, { kind: 'idle' });
  // Exporting and erasing need a recent sign-in (M1.2c): the dialog confirms, then resends.
  const [exported, exportAction, exporting, exportForm] = useStepUpActionState<ExportState>(exportData, {
    kind: 'idle',
  });
  const [erased, eraseAction, erasing, eraseForm] = useStepUpActionState<EraseState>(erase, { kind: 'idle' });
  const [subject, setSubject] = useState<string | null>(null);
  const confirmId = useId();
  // A new search starts a new request: older export/erase results belong to the previous person.
  useEffect(() => {
    if (found.kind === 'found') setSubject(found.email);
  }, [found]);
  const message = (code: string) =>
    code === 'invalid_email'
      ? t('privacy.errors.invalidEmail')
      : code === 'confirm_mismatch'
        ? t('privacy.errors.confirmMismatch')
        : code === 'not_found'
          ? t('privacy.errors.nothingHeld')
          : t(errorMessageKey(code));
  const current = found.kind === 'found' && found.email === subject ? found : null;
  const showErased = erased.kind === 'erased' && current;

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

      {current && !showErased ? (
        current.found ? (
          <section aria-labelledby="dsar-result" className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3">
              <h2 id="dsar-result" className="text-section">
                {t('privacy.result.title', { email: current.email })}
              </h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="dsar-summary">
                {CATEGORIES.map((c) => (
                  <div
                    key={c}
                    className="flex items-baseline justify-between gap-3 border-b border-line py-1"
                  >
                    <dt className="text-body text-ink-2">{t(`privacy.categories.${c}`)}</dt>
                    <dd className="font-mono text-body">{current.summary[c]}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card className="flex flex-col gap-3">
              <h2 className="text-section">{t('privacy.export.title')}</h2>
              <p className="text-body text-ink-2">{t('privacy.export.hint')}</p>
              <form ref={exportForm} action={exportAction}>
                <input type="hidden" name="email" value={current.email} />
                <Button type="submit" variant="secondary" disabled={exporting}>
                  {t('privacy.export.submit')}
                </Button>
              </form>
              <div aria-live="polite">
                {exported.kind === 'started' ? (
                  exported.done ? (
                    <a
                      href={`${downloadBase}/${exported.operationId}`}
                      className={buttonClass('primary', 'sm', 'self-start')}
                      download
                    >
                      {t('privacy.export.download')}
                    </a>
                  ) : (
                    <p className="text-body">{t('privacy.export.running')}</p>
                  )
                ) : exported.kind === 'error' ? (
                  <Alert title={message(exported.code)} />
                ) : null}
              </div>
            </Card>

            <Card className="flex flex-col gap-3 border-danger">
              <h2 className="text-section">{t('privacy.erase.title')}</h2>
              <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
                <li>{t('privacy.erase.what')}</li>
                <li>{t('privacy.erase.holds', { paid: current.summary.paidOrders })}</li>
                <li>{t('privacy.erase.tickets', { active: current.summary.activeTickets })}</li>
                <li>{t('privacy.erase.final')}</li>
              </ul>
              <form ref={eraseForm} action={eraseAction} className="flex flex-col gap-3" noValidate>
                <input type="hidden" name="email" value={current.email} />
                <Input
                  id={confirmId}
                  name="confirm"
                  type="email"
                  autoComplete="off"
                  required
                  label={t('privacy.erase.confirm', { email: current.email })}
                  error={erased.kind === 'error' ? message(erased.code) : undefined}
                />
                <Button type="submit" disabled={erasing} className="self-start">
                  {t('privacy.erase.submit')}
                </Button>
              </form>
            </Card>
          </section>
        ) : (
          <EmptyState
            title={t('privacy.result.noneTitle')}
            description={t('privacy.result.noneDescription')}
          />
        )
      ) : null}

      <div aria-live="polite">
        {showErased && erased.kind === 'erased' ? (
          <p
            role="status"
            className="rounded-card border border-success bg-surface px-4 py-3 text-body"
            data-testid="dsar-erased"
          >
            {t('privacy.erase.done', {
              records: Object.entries(erased.summary)
                .filter(([k]) => !['consentsKept', 'paidOrdersKept', 'activeTicketsKept'].includes(k))
                .reduce((a, [, v]) => a + v, 0),
              kept: erased.summary.paidOrdersKept ?? 0,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
