import { agencyClientsQuery } from '@yayatoh/agency';
import { agencyLibraryQuery } from '@yayatoh/agency-ops';
import { executeQuery } from '@yayatoh/kernel';
import { listTemplatesQuery } from '@yayatoh/templates';
import { buttonClass, Card, CardHeader, EmptyState, SectionHeader, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadAgencyV2 } from '../load.ts';
import { publishKitAction, publishTemplateAction, saveKitAction, savePrivacyAction } from '../ops-actions.ts';
import { KitForm, PrivacyForm, PublishForm } from '../ops-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.library') };
}

/**
 * Library (M6.8b): the agency's templates and brand kits, what of each stays private, and
 * publishing them downward. Each client gets its own copy; private parts never leave the agency.
 */
export default async function AgencyLibraryPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead, canManage } = await loadAgencyV2(org);
  if (!canRead) return null;
  const t = await getTranslations('agencyOps');
  const [templates, lib, clients] = await Promise.all([
    executeQuery(listTemplatesQuery, {}, data.ctx, ports),
    executeQuery(agencyLibraryQuery, {}, data.ctx, ports),
    executeQuery(agencyClientsQuery, {}, data.ctx, ports),
  ]);
  const options = clients.map((c) => ({ id: c.clientOrgId, name: c.name, role: c.role }));
  const published = (sourceId: string) =>
    lib.publications.filter((p) => p.sourceId === sourceId && p.status === 'published').length;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-2">{t('library.intro')}</p>
      <section aria-labelledby="library-templates" className="flex flex-col gap-3">
        <SectionHeader id="library-templates" title={t('library.templatesTitle')} />
        {templates.length === 0 ? (
          <EmptyState
            title={t('library.templatesEmptyTitle')}
            description={t('library.templatesEmptyDescription')}
            action={
              <Link href={`/o/${org}/templates`} className={buttonClass('secondary', 'md')}>
                {t('library.templatesEmptyAction')}
              </Link>
            }
          />
        ) : (
          templates.map((tpl) => {
            const s = lib.templateSettings.find((x) => x.templateId === tpl.id);
            return (
              <Card key={tpl.id} className="flex flex-col gap-4">
                <CardHeader
                  title={tpl.name}
                  meta={
                    <span className="flex flex-wrap gap-1.5">
                      <StatusPill
                        tone="neutral"
                        label={t('library.publishedCount', { count: published(tpl.id) })}
                      />
                      {(s?.privateParts ?? []).map((p) => (
                        <StatusPill key={p} tone="info" label={t(`library.private_${p}`)} />
                      ))}
                    </span>
                  }
                />
                {canManage ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <PrivacyForm
                      action={savePrivacyAction.bind(null, org, tpl.id)}
                      templateId={tpl.id}
                      notes={s?.privateNotes ?? ''}
                      parts={s?.privateParts ?? []}
                    />
                    <PublishForm
                      action={publishTemplateAction.bind(null, org, tpl.id)}
                      clients={options}
                      idPrefix={`tpl-${tpl.id}`}
                      label={t('library.publishNamed', { name: tpl.name })}
                    />
                  </div>
                ) : null}
              </Card>
            );
          })
        )}
      </section>
      <section aria-labelledby="library-kits" className="flex flex-col gap-3">
        <SectionHeader id="library-kits" title={t('library.kitsTitle')} />
        {canManage ? (
          <Card>
            <KitForm action={saveKitAction.bind(null, org)} />
          </Card>
        ) : null}
        {lib.brandKits.length === 0 ? (
          <EmptyState
            title={t('library.kitsEmptyTitle')}
            description={t('library.kitsEmptyDescription')}
            action={
              canManage ? (
                <a href="#kit-name" className={buttonClass('primary', 'md')}>
                  {t('library.createKit')}
                </a>
              ) : (
                <Link href={`/o/${org}/agency`} className={buttonClass('primary', 'md')}>
                  {t('actions.openClients')}
                </Link>
              )
            }
          />
        ) : (
          lib.brandKits.map((kit) => (
            <Card key={kit.id} className="flex flex-col gap-4">
              <CardHeader
                title={kit.name}
                meta={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span dir="ltr" className="font-mono text-caption">
                      {kit.brandColor}
                    </span>
                    <StatusPill
                      tone="neutral"
                      label={t('library.publishedCount', { count: published(kit.id) })}
                    />
                  </span>
                }
              />
              {canManage ? (
                <PublishForm
                  action={publishKitAction.bind(null, org, kit.id)}
                  clients={options}
                  idPrefix={`kit-${kit.id}`}
                  label={t('library.publishNamed', { name: kit.name })}
                />
              ) : null}
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
