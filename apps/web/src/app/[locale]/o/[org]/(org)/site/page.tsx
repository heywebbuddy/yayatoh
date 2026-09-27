import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { siteSettingsQuery } from '@yayatoh/marketplace';
import { managedHostname, roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopySnippet } from '@/components/copy-snippet.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { widgetSnippet } from '@/lib/widget.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin } from '@/server/seo.ts';
import { publicSiteAction, widgetOriginsAction } from './actions.ts';

/**
 * Public site (M1.11): marketplace enrollment (owner D13, opt-in), the tenant site, and the
 * embeddable ticket widget (allowed websites and a snippet per public event).
 */
export default async function SitePage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('site');
  const settings = await executeQuery(siteSettingsQuery, {}, data.ctx, ports);
  const events = (await executeQuery(listEventsQuery, {}, data.ctx, ports)).filter(
    (e) => (e.status === 'published' || e.status === 'postponed') && e.visibility !== 'private',
  );
  const canManage = roleCan(data.role, 'org:update');
  const origin = apexOrigin(await requestHost());
  const snippet = (slug: string, name: string) =>
    widgetSnippet(origin, slug, t('widget.frameTitle', { event: name }));
  const check = (name: string, checked: boolean, label: string, hint: string) => (
    <label className="flex min-h-6 items-start gap-3 text-body">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        disabled={!canManage}
        aria-describedby={`${name}-hint`}
        className="mt-0.5 size-5 accent-ink"
      />
      <span className="flex flex-col gap-0.5">
        {label}
        <span id={`${name}-hint`} className="text-caption text-zinc-500">
          {hint}
        </span>
      </span>
    </label>
  );
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {canManage ? null : (
        <p
          role="note"
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-600"
        >
          {t('readOnly')}
        </p>
      )}

      <section aria-labelledby="listing-heading" className="flex flex-col gap-3">
        <h2 id="listing-heading" className="text-section">
          {t('listing.title')}
        </h2>
        <Card>
          {canManage ? (
            <SettingsForm
              action={publicSiteAction.bind(null, org)}
              submitLabel={t('save')}
              savedLabel={t('saved')}
            >
              {check(
                'listOnMarketplace',
                settings.listOnMarketplace,
                t('listing.marketplace'),
                t('listing.marketplaceHint'),
              )}
              {check(
                'tenantSite',
                settings.tenantSite,
                t('listing.tenantSite', { host: managedHostname(data.org.slug) }),
                t('listing.tenantSiteHint'),
              )}
            </SettingsForm>
          ) : (
            <div className="flex flex-col gap-4">
              {check(
                'listOnMarketplace',
                settings.listOnMarketplace,
                t('listing.marketplace'),
                t('listing.marketplaceHint'),
              )}
              {check(
                'tenantSite',
                settings.tenantSite,
                t('listing.tenantSite', { host: managedHostname(data.org.slug) }),
                t('listing.tenantSiteHint'),
              )}
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="widget-heading" className="flex flex-col gap-3">
        <h2 id="widget-heading" className="text-section">
          {t('widget.title')}
        </h2>
        <p className="text-body text-zinc-600">{t('widget.description')}</p>
        <Card>
          {canManage ? (
            <SettingsForm
              action={widgetOriginsAction.bind(null, org)}
              submitLabel={t('save')}
              savedLabel={t('saved')}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="widget-origins" className="text-caption text-zinc-600">
                  {t('widget.origins')}
                </label>
                <textarea
                  id="widget-origins"
                  name="origins"
                  rows={4}
                  dir="ltr"
                  defaultValue={settings.embedOrigins.join('\n')}
                  aria-describedby="widget-origins-hint"
                  className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
                />
                <p id="widget-origins-hint" className="text-caption text-zinc-500">
                  {t('widget.originsHint')}
                </p>
              </div>
            </SettingsForm>
          ) : (
            <p className="text-body">
              {settings.embedOrigins.length > 0 ? settings.embedOrigins.join(', ') : t('widget.noOrigins')}
            </p>
          )}
        </Card>
        {events.length === 0 ? (
          <EmptyState title={t('widget.emptyTitle')} description={t('widget.emptyDescription')} />
        ) : (
          <ul aria-label={t('widget.snippets')} className="flex list-none flex-col gap-3 p-0">
            {events.map((e) => (
              <li key={e.id}>
                <Card>
                  <CopySnippet
                    label={t('widget.snippetFor', { event: e.name })}
                    code={snippet(e.slug, e.name)}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
