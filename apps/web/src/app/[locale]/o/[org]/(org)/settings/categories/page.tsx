import { EVENT_CATEGORIES, orgCategoriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Breadcrumb, Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AddCategoryForm, CategoryList } from '@/components/category-manager.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { addCategoryAction, categoryRowAction } from './actions.ts';

/**
 * U8 (UX-2): the org's event categories. Owners and admins add, rename, hide and reorder them;
 * each maps to a marketplace category. Everyone else is refused (the settings permission).
 */
export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'org:update')) notFound();
  const t = await getTranslations('orgCategories');
  const tg = await getTranslations();
  const list = await executeQuery(orgCategoriesQuery, { includeHidden: true }, data.ctx, ports);
  const platformLabel = (key: string) => tg(`categories.${key as (typeof EVENT_CATEGORIES)[number]}`);
  const rows = list.map((c) => ({
    ref: c.ref,
    label: c.name ?? platformLabel(c.platformKey),
    platformLabel: platformLabel(c.platformKey),
    renamed: c.name !== null,
    hidden: c.hidden,
    eventCount: c.eventCount,
  }));
  const visible = rows.filter((r) => !r.hidden).length;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            label={t('breadcrumb')}
            link={Link}
            items={[{ label: tg('settings.title'), href: `/o/${org}/settings` }, { label: t('title') }]}
          />
        }
        title={t('title')}
        description={t('description')}
      />
      <Card size="panel" className="flex flex-col gap-3">
        <h2 className="text-section">{t('howTitle')}</h2>
        <ul className="m-0 flex list-disc flex-col gap-1.5 ps-5 text-body text-ink-2">
          <li>{t('howMarketplace')}</li>
          <li>{t('howHidden')}</li>
          <li>{t('howTags')}</li>
        </ul>
      </Card>
      <section aria-labelledby="add-category-heading" className="flex flex-col gap-3">
        <h2 id="add-category-heading" className="text-section">
          {t('addTitle')}
        </h2>
        <Card size="panel">
          <AddCategoryForm
            action={addCategoryAction.bind(null, org)}
            platformCategories={EVENT_CATEGORIES.map((key) => ({ key, label: platformLabel(key) }))}
          />
        </Card>
      </section>
      <section aria-labelledby="category-list-heading" className="flex flex-col gap-3">
        <h2 id="category-list-heading" className="text-section">
          {t('listTitle', { count: rows.length, visible })}
        </h2>
        <CategoryList rows={rows} action={categoryRowAction.bind(null, org)} />
      </section>
    </>
  );
}
