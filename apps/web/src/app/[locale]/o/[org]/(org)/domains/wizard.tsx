import type { DomainDto } from '@yayatoh/tenancy';
import { Alert, Button, Card, Stepper } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { CopyValue } from '@/components/domains/copy-value.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { wizardStates, wizardStep } from '@/lib/domain-wizard.ts';
import { checkDomainAction, setPrimaryDomainAction } from './actions.ts';

/** "How it works" (U3, principle 3): what connecting a domain takes, before any form. */
export async function HowItWorks() {
  const t = await getTranslations('domains.how');
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-card">{t('title')}</h2>
      <ol className="m-0 flex list-decimal flex-col gap-1.5 ps-5 text-body text-ink-2">
        <li>{t('add')}</li>
        <li>{t('dns')}</li>
        <li>{t('check')}</li>
        <li>{t('live')}</li>
      </ol>
    </Card>
  );
}

/**
 * The connect wizard of one custom domain (U3): the stepper, then only what the current step
 * needs: the DNS records to copy (with provider-agnostic instructions), the live check, the
 * certificate, and "Make primary". The hosting provider's checks drive every step.
 */
export async function ConnectWizard({
  org,
  domain: d,
  canManage,
  lastChecked,
}: {
  org: string;
  domain: DomainDto;
  canManage: boolean;
  lastChecked: string | null;
}) {
  const t = await getTranslations('domains');
  const step = wizardStep(d);
  // Copy buttons name the record by its type ("TXT"), numbered only when a type repeats; the
  // record's name stays out of the label so each table cell keeps one accessible name.
  const recordLabel = (r: { type: string }, i: number) =>
    d.records.filter((x) => x.type === r.type).length > 1 ? `${r.type} ${i + 1}` : r.type;
  const check = canManage ? (
    <form action={checkDomainAction.bind(null, org, d.id)}>
      <Button type="submit" size="sm" variant={step === 'primary' ? 'secondary' : 'primary'}>
        {t('check')}
        <span className="sr-only"> {d.hostname}</span>
      </Button>
    </form>
  ) : null;
  return (
    <section aria-label={t('wizard.label', { host: d.hostname })} className="flex flex-col gap-4">
      <Stepper
        label={t('wizard.steps', { host: d.hostname })}
        steps={wizardStates(d).map((s) => ({ label: t(`wizard.step.${s.step}`), state: s.state }))}
      />
      {step === 'dns' ? (
        <div className="flex flex-col gap-3">
          {d.status === 'failed' ? (
            <Alert title={t(`reason.${d.failureReason === 'dns_conflict' ? 'dns_conflict' : 'unknown'}`)} />
          ) : null}
          <p className="m-0 text-body">{t('recordsIntro')}</p>
          <ol className="m-0 flex list-decimal flex-col gap-1 ps-5 text-caption text-ink-2">
            <li>{t('wizard.dns.signIn')}</li>
            <li>{t('wizard.dns.open')}</li>
            <li>{t('wizard.dns.add')}</li>
            <li>{t('wizard.dns.back')}</li>
          </ol>
          {d.records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-caption">
                <caption className="sr-only">{t('recordsCaption', { host: d.hostname })}</caption>
                <thead>
                  <tr className="text-ink-2">
                    <th scope="col" className="py-1 pe-4 text-start font-normal">
                      {t('recordType')}
                    </th>
                    <th scope="col" className="py-1 pe-4 text-start font-normal">
                      {t('recordName')}
                    </th>
                    <th scope="col" className="py-1 text-start font-normal">
                      {t('recordValue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.records.map((r, i) => (
                    <tr key={`${r.type}:${r.name}`} className="border-t border-line">
                      <td className="py-1.5 pe-4 align-top font-mono">{r.type}</td>
                      <td className="py-1.5 pe-4 align-top">
                        <span className="flex flex-col items-start gap-1.5">
                          <span className="font-mono break-all" dir="ltr">
                            {r.name}
                          </span>
                          <CopyValue
                            value={r.name}
                            label={t('wizard.copyName', { type: recordLabel(r, i) })}
                          />
                        </span>
                      </td>
                      <td className="py-1.5 align-top">
                        <span className="flex flex-col items-start gap-1.5">
                          <span className="font-mono break-all" dir="ltr">
                            {r.value}
                          </span>
                          <CopyValue
                            value={r.value}
                            label={t('wizard.copyValue', { type: recordLabel(r, i) })}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="m-0 text-caption text-ink-2">{t('autoCheck')}</p>
        </div>
      ) : step === 'verify' ? (
        <p className="m-0 text-body">{t('wizard.verify')}</p>
      ) : step === 'ssl' ? (
        <p className="m-0 text-body">{t('wizard.ssl')}</p>
      ) : (
        <p className="m-0 text-body">{t('wizard.primary', { host: d.hostname })}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {step === 'primary' && canManage ? (
          <StepUpForm action={setPrimaryDomainAction.bind(null, org, d.id)}>
            <Button type="submit" size="sm">
              {t('makePrimary')}
              <span className="sr-only"> {d.hostname}</span>
            </Button>
          </StepUpForm>
        ) : null}
        {check}
        {lastChecked ? (
          <span className="text-caption text-ink-2" aria-live="polite">
            {t('lastChecked', { when: lastChecked })}
          </span>
        ) : null}
      </div>
    </section>
  );
}
