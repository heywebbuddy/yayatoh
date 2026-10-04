import type { LeadSetupDto } from '@yayatoh/leads';
import { Alert, buttonClass, Card, SectionHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { acceptLeadTermsAction, saveLeadSettingsAction } from './leads-actions.ts';

/**
 * Lead retrieval in the exhibitor portal (M5.6b, P5-4/P5-8): where to capture (the Scan PWA's
 * lead mode), the capture window in the event's zone, and for the exhibitor admin the lead terms
 * click-through, the qualifiers and team visibility, and the CSV export (behind a fresh emailed
 * sign-in code). Staff see their own standing only.
 */
export async function LeadsSection({
  setup,
  locale,
  exportReady,
}: {
  setup: LeadSetupDto;
  locale: string;
  exportReady: boolean;
}) {
  const t = await getTranslations('leads');
  const admin = setup.role === 'exhibitor_admin';
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: setup.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const ready = setup.license === 'licensed' && setup.termsAccepted && setup.capture.state === 'open';
  return (
    <section aria-labelledby="leads-heading" className="flex flex-col gap-3">
      <SectionHeader id="leads-heading" title={t('portal.heading')} />
      <Card size="panel" className="flex flex-col gap-3">
        <p className="m-0 flex flex-wrap items-center gap-2 text-body">
          <StatusPill
            tone={setup.license === 'licensed' ? 'success' : 'waiting'}
            label={t(`license.${setup.license}`)}
          />
          <StatusPill
            tone={setup.capture.state === 'open' ? 'success' : 'neutral'}
            label={t(`capture.${setup.capture.state}`)}
          />
        </p>
        <p className="m-0 text-caption text-ink-2">
          {t('portal.window', {
            opens: when.format(setup.capture.opensAt),
            closes: when.format(setup.capture.closesAt),
            until: when.format(setup.capture.accessUntil),
          })}
        </p>
        {!setup.termsAccepted ? (
          <p className="m-0 text-body">
            {admin ? t('portal.termsNeededAdmin') : t('portal.termsNeededStaff')}
          </p>
        ) : null}
        {setup.license !== 'licensed' ? (
          <p className="m-0 text-body">{t(`portal.why.${setup.license}`)}</p>
        ) : null}
        <a
          href={`${prefix}/scan/leads`}
          className={buttonClass(ready ? 'primary' : 'secondary', 'md', 'self-start')}
        >
          {t('portal.open')}
        </a>
      </Card>

      {admin ? (
        <>
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="m-0 text-card text-ink">{t('terms.heading')}</h3>
            <p className="m-0 text-body">{t('terms.v1')}</p>
            {setup.termsAccepted ? (
              <StatusPill tone="success" label={t('terms.accepted')} />
            ) : (
              <ProgramForm
                action={acceptLeadTermsAction}
                idPrefix="lead-terms"
                fields={[
                  {
                    kind: 'checkboxes',
                    name: 'accept',
                    label: t('terms.acceptLabel'),
                    options: [{ value: 'on', label: t('terms.accept', { exhibitor: setup.exhibitorName }) }],
                  },
                ]}
                submitLabel={t('terms.submit')}
                successLabel={t('terms.accepted')}
                errors={{ accept: t('terms.acceptRequired'), accept_required: t('terms.acceptRequired') }}
              />
            )}
          </Card>

          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="m-0 text-card text-ink">{t('settings.heading')}</h3>
            <ProgramForm
              action={saveLeadSettingsAction}
              idPrefix="lead-settings"
              fields={[
                {
                  kind: 'textarea',
                  name: 'qualifiers',
                  label: t('settings.qualifiers'),
                  hint: t('settings.qualifiersHint'),
                  rows: 4,
                  defaultValue: setup.qualifiers.join('\n'),
                },
                {
                  kind: 'checkboxes',
                  name: 'teamVisibility',
                  label: t('settings.visibility'),
                  options: [{ value: 'on', label: t('settings.teamVisibility') }],
                  defaultValues: setup.teamVisibility ? ['on'] : [],
                },
              ]}
              submitLabel={t('settings.save')}
              successLabel={t('settings.saved')}
              errors={{
                qualifiers: t('settings.qualifiersInvalid'),
                too_many_qualifiers: t('settings.tooMany'),
              }}
            />
          </Card>

          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="m-0 text-card text-ink">{t('export.heading')}</h3>
            {exportReady ? <Alert tone="success" title={t('export.ready')} /> : null}
            <p className="m-0 text-body tabular-nums">{t('export.count', { count: setup.leadCount })}</p>
            <p className="m-0 text-caption text-ink-2">{t('export.hint')}</p>
            {setup.capture.accessOpen ? (
              <a
                href={`/api/portal/leads/export?locale=${locale}`}
                className={buttonClass('secondary', 'md', 'self-start')}
              >
                {t('export.download')}
              </a>
            ) : (
              <p className="m-0 text-body">{t('export.ended')}</p>
            )}
          </Card>
        </>
      ) : null}
    </section>
  );
}
