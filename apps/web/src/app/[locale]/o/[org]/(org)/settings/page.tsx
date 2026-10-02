import { LOCALES } from '@yayatoh/contracts';
import { executeQuery } from '@yayatoh/kernel';
import {
  AGREEMENT_DOCUMENTS,
  agreementsQuery,
  LEGAL_PAGE_KINDS,
  legalPagesQuery,
  roleCan,
} from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, light, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BrandColorField } from '@/components/brand-color-field.tsx';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';
import { acceptAction, brandAction, generalAction, legalAction } from './actions.ts';

const field = 'field';

/** Organization settings: general, brand kit, the organizer's legal pages, platform agreements. */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ need?: string }>;
}) {
  const { locale, org } = await params;
  const { need } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'org:update')) {
    return (
      <>
        <PageHeader title={t('settings.title')} />
        <EmptyState title={t('settings.noAccessTitle')} description={t('settings.noAccessDescription')} />
      </>
    );
  }
  const o = data.org;
  const legal = await executeQuery(legalPagesQuery, {}, data.ctx, ports);
  const agreements = await executeQuery(agreementsQuery, {}, data.ctx, ports);
  const logo = await mediaPanel(data, 'org', o.id, 'logo');
  const canAccept = roleCan(data.role, 'members:manage');
  const zones = Intl.supportedValuesOf('timeZone');
  const labelled = (id: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <>
      <PageHeader
        title={t('settings.title')}
        description={o.name}
        actions={
          <>
            {roleCan(data.role, 'audit:read') ? (
              <Link href={`/o/${org}/activity`} className={buttonClass('secondary', 'sm')}>
                {t('settings.activityLink')}
              </Link>
            ) : null}
            {roleCan(data.role, 'privacy:manage') ? (
              <Link href={`/o/${org}/privacy`} className={buttonClass('secondary', 'sm')}>
                {t('settings.privacyLink')}
              </Link>
            ) : null}
            {roleCan(data.role, 'billing:read') ? (
              <Link href={`/o/${org}/plan`} className={buttonClass('secondary', 'sm')}>
                {t('settings.planLink')}
              </Link>
            ) : null}
          </>
        }
      />
      {need === 'terms' ? (
        <p
          role="alert"
          className="rounded-card border border-primary bg-primary-soft px-4 py-3 text-body text-primary-ink"
        >
          {t('settings.agreements.needed')}
        </p>
      ) : null}

      <section aria-labelledby="agreements-heading" className="flex flex-col gap-3">
        <h2 id="agreements-heading" className="text-section">
          {t('settings.agreements.title')}
        </h2>
        <Card className="flex flex-col gap-4">
          {AGREEMENT_DOCUMENTS.map((doc) => {
            const a = agreements.find((x) => x.document === doc);
            return (
              <div
                key={doc}
                className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0"
              >
                <p className="text-body">
                  <Link href={`/legal/platform/${doc}`} className="underline">
                    {t(`settings.agreements.doc.${doc}`)}
                  </Link>{' '}
                  <span className="text-caption text-ink-2">
                    {t('settings.agreements.version', { version: a?.currentVersion ?? '' })}
                  </span>
                </p>
                {a?.acceptedAt ? (
                  <p className="text-caption text-ink-2">
                    {t('settings.agreements.acceptedOn', {
                      date: new Intl.DateTimeFormat(locale, {
                        dateStyle: 'medium',
                        timeZone: o.timezone,
                      }).format(a.acceptedAt),
                    })}
                  </p>
                ) : canAccept && a ? (
                  <SettingsForm
                    action={acceptAction.bind(null, org, doc, a.currentVersion)}
                    submitLabel={t('settings.agreements.accept')}
                    savedLabel={t('settings.agreements.accepted')}
                  >
                    <label className="flex min-h-6 items-start gap-2 text-body">
                      <input
                        type="checkbox"
                        name="agree"
                        value="yes"
                        required
                        className="mt-0.5 size-5 accent-primary"
                      />
                      {t('settings.agreements.agree', { document: t(`settings.agreements.doc.${doc}`) })}
                    </label>
                  </SettingsForm>
                ) : (
                  <p className="text-caption text-ink-2">{t('settings.agreements.ownerOnly')}</p>
                )}
              </div>
            );
          })}
        </Card>
      </section>

      <section aria-labelledby="general-heading" className="flex flex-col gap-3">
        <h2 id="general-heading" className="text-section">
          {t('settings.general.title')}
        </h2>
        <Card>
          <SettingsForm
            action={generalAction.bind(null, org)}
            submitLabel={t('settings.save')}
            savedLabel={t('settings.saved')}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {labelled(
              'org-name',
              t('settings.general.name'),
              <input
                id="org-name"
                name="name"
                required
                maxLength={120}
                defaultValue={o.name}
                className={field}
              />,
            )}
            {labelled(
              'org-locale',
              t('settings.general.locale'),
              <select id="org-locale" name="defaultLocale" defaultValue={o.defaultLocale} className={field}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l}
                  </option>
                ))}
              </select>,
            )}
            {labelled(
              'org-timezone',
              t('settings.general.timezone'),
              <select id="org-timezone" name="timezone" defaultValue={o.timezone} className={field}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>,
            )}
            {labelled(
              'org-country',
              t('settings.general.country'),
              <input
                id="org-country"
                name="country"
                required
                pattern="[A-Za-z]{2}"
                maxLength={2}
                defaultValue={o.country}
                aria-describedby="org-country-hint"
                className={field}
              />,
            )}
            {labelled(
              'org-currency',
              t('settings.general.currency'),
              <input
                id="org-currency"
                name="currency"
                required
                pattern="[A-Za-z]{3}"
                maxLength={3}
                defaultValue={o.currency}
                aria-describedby="org-currency-hint"
                className={field}
              />,
            )}
            <p id="org-currency-hint" className="text-caption text-ink-2 md:col-span-2">
              {t('settings.general.currencyHint')}
            </p>
            <p id="org-country-hint" className="sr-only">
              {t('settings.general.countryHint')}
            </p>
          </SettingsForm>
        </Card>
      </section>

      <section aria-labelledby="brand-heading" className="flex flex-col gap-3">
        <h2 id="brand-heading" className="text-section">
          {t('settings.brand.title')}
        </h2>
        <Card>
          <SettingsForm
            action={brandAction.bind(null, org)}
            submitLabel={t('settings.save')}
            savedLabel={t('settings.saved')}
          >
            <p className="text-body text-ink-2">{t('settings.brand.description')}</p>
            <BrandColorField initial={o.brandColor} fallback={light.primary.toLowerCase()} />
          </SettingsForm>
        </Card>
      </section>

      <Card size="panel">
        <MediaUploader org={org} slot="logo" ticket={logo.ticket} items={logo.items} />
      </Card>

      <section aria-labelledby="legal-heading" className="flex flex-col gap-3">
        <h2 id="legal-heading" className="text-section">
          {t('settings.legal.title')}
        </h2>
        <p className="text-body text-ink-2">{t('settings.legal.description')}</p>
        {LEGAL_PAGE_KINDS.map((kind) => {
          const page = legal.find((p) => p.kind === kind);
          return (
            <Card key={kind}>
              <SettingsForm
                action={legalAction.bind(null, org, kind)}
                submitLabel={t('settings.save')}
                savedLabel={t('settings.saved')}
              >
                {labelled(
                  `legal-${kind}`,
                  t(`settings.legal.kind.${kind}`),
                  <textarea
                    id={`legal-${kind}`}
                    name="body"
                    rows={6}
                    maxLength={50_000}
                    defaultValue={page?.body ?? ''}
                    className="rounded-card border border-line bg-surface px-4 py-3 text-body"
                  />,
                )}
                {page ? (
                  <Link href={`/legal/${org}/${kind}`} className="self-start text-caption underline">
                    {t('settings.legal.view')}
                  </Link>
                ) : null}
              </SettingsForm>
            </Card>
          );
        })}
      </section>
    </>
  );
}
