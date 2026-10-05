import { currencyExponent, executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { leadLicensesAdminQuery } from '@yayatoh/program';
import { Alert, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { saveLicenseSettingsAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

/**
 * Lead licenses (M5.4b, P5-4): how many each exhibitor gets (included + sponsor packages +
 * bought), how many are in use, the staff badges packages add, and the price of an extra license
 * (the organizer's add-on, bought in the exhibitor portal). Viewers read.
 */
export default async function LeadLicensesPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'exhibitors');
  const q = await executeQuery(leadLicensesAdminQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('leadLicenses');
  const tn = await getTranslations('nav');
  const tp = await getTranslations('program');
  const base = `/o/${org}/e/${event}`;
  const s = q.settings;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: base },
              { label: tn('exhibitors'), href: `${base}/exhibitors` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('subtitle')}
      />
      {canWrite ? null : <Alert tone="info" title={tp('viewerNotice')} />}

      <section aria-labelledby="license-settings-heading" className="flex flex-col gap-3">
        <h2 id="license-settings-heading" className="text-section">
          {t('settingsHeading')}
        </h2>
        <Card size="panel" className="flex flex-col gap-3">
          <p className="m-0 text-body">
            {t('settingsSummary', { included: s.includedLeadLicenses })}{' '}
            {s.leadLicensePriceMinor === null
              ? t('notForSale')
              : t('forSale', { price: formatMoney(money(s.leadLicensePriceMinor, s.currency), locale) })}
          </p>
          {canWrite ? (
            <ProgramForm
              action={saveLicenseSettingsAction.bind(null, org, event)}
              idPrefix="license-settings"
              submitLabel={t('save')}
              successLabel={t('saved')}
              errors={{ included: t('errors.included'), price: t('errors.price') }}
              fields={[
                {
                  kind: 'number',
                  name: 'included',
                  label: t('included'),
                  hint: t('includedHint'),
                  required: true,
                  min: 0,
                  defaultValue: String(s.includedLeadLicenses),
                },
                {
                  kind: 'text',
                  name: 'price',
                  label: t('price', { currency: s.currency }),
                  hint: t('priceHint'),
                  maxLength: 20,
                  defaultValue:
                    s.leadLicensePriceMinor === null
                      ? undefined
                      : String(s.leadLicensePriceMinor / 10 ** currencyExponent(s.currency)),
                },
              ]}
            />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="license-exhibitors-heading" className="flex flex-col gap-3">
        <h2 id="license-exhibitors-heading" className="text-section">
          {t('exhibitorsHeading', { count: q.exhibitors.length })}
        </h2>
        {q.exhibitors.length === 0 ? (
          <EmptyState
            title={tp('emptyExhibitorsTitle')}
            description={t('emptyDescription')}
            action={
              <Link href={`${base}/exhibitors`} className="text-body underline">
                {tp('addExhibitor')}
              </Link>
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {q.exhibitors.map((x) => (
              <li key={x.exhibitorId}>
                <Card className="flex flex-col gap-1">
                  <h3 className="m-0 text-card">{x.name}</h3>
                  <p className="m-0 text-body tabular-nums">
                    {t('licensesLine', {
                      used: x.licenses.used,
                      allowance: x.licenses.allowance,
                      included: x.licenses.included,
                      packages: x.licenses.fromPackages,
                      purchased: x.licenses.purchased,
                    })}
                  </p>
                  <p className="m-0 text-caption text-ink-2 tabular-nums">
                    {t('badgesLine', { base: x.staffBadges.base, packages: x.staffBadges.fromPackages })}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
