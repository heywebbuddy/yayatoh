import { CMS_WRITE, type HelpArticleRowDto, type HelpCategoryDto, listHelpQuery } from '@yayatoh/cms';
import { LOCALES } from '@yayatoh/contracts';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CategoryForm } from '@/components/help/category-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createCategoryAction } from './actions.ts';

const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** M3.11b: the platform help center (content org only): articles and categories. */
export default async function HelpCenterConsole({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ tab?: string; deleted?: string; created?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org)) notFound();
  const sp = await searchParams;
  const tab = sp.tab === 'categories' ? 'categories' : 'articles';
  const data = await loadConsole(org);
  const t = await getTranslations('helpConsole');
  const tc = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const { categories, articles } = await executeQuery(listHelpQuery, {}, data.ctx, ports);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const localeName = (l: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
  const tabLink = (k: 'articles' | 'categories') => (
    <Link
      href={`/o/${org}/help-center${k === 'categories' ? '?tab=categories' : ''}`}
      aria-current={tab === k ? 'page' : undefined}
      className={buttonClass(tab === k ? 'primary' : 'secondary', 'sm')}
    >
      {t(`tabs.${k}`)}
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite && tab === 'articles' && categories.length > 0 ? (
            <Link href={`/o/${org}/help-center/new`} className={buttonClass('primary')}>
              {t('newArticle')}
            </Link>
          ) : null
        }
      />
      {canWrite ? null : (
        <p role="note" className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-600">
          {tc('readOnly')}
        </p>
      )}
      {sp.deleted ? <Alert tone="info" title={tc('deleted')} /> : null}
      {sp.created ? <Alert tone="info" title={t('categoryCreated')} /> : null}
      <nav aria-label={t('tabsLabel')} className="flex gap-2">
        {tabLink('articles')}
        {tabLink('categories')}
      </nav>
      {tab === 'articles' ? (
        articles.length === 0 ? (
          <EmptyState
            title={t('emptyArticlesTitle')}
            description={t(categories.length === 0 ? 'emptyNeedsCategory' : 'emptyArticlesDescription')}
          />
        ) : (
          <Table
            caption={t('tabs.articles')}
            rowKey={(r) => r.id}
            rows={articles}
            columns={[
              {
                key: 'title',
                header: tc('columns.title'),
                cell: (r: HelpArticleRowDto) => (
                  <span className="flex flex-col">
                    <Link href={`/o/${org}/help-center/${r.id}`} className="underline underline-offset-2">
                      {r.title}
                    </Link>
                    <span className="text-caption text-zinc-500">
                      <span dir="ltr" className="font-mono">
                        {r.slug}
                      </span>{' '}
                      · {localeName(r.locale)}
                    </span>
                  </span>
                ),
              },
              {
                key: 'category',
                header: t('columns.category'),
                cell: (r: HelpArticleRowDto) => byId.get(r.categoryId)?.title ?? '',
              },
              {
                key: 'status',
                header: tc('columns.status'),
                cell: (r: HelpArticleRowDto) => <StatusDot status={DOT[r.status]} label={tc(`status.${r.status}`)} />,
              },
              {
                key: 'helpful',
                header: t('columns.helpful'),
                mono: true,
                cell: (r: HelpArticleRowDto) => t('helpfulCounts', { yes: r.helpfulYes, no: r.helpfulNo }),
              },
              {
                key: 'updated',
                header: tc('columns.updated'),
                mono: true,
                align: 'end',
                cell: (r: HelpArticleRowDto) =>
                  formatDate(r.updatedAt.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
              },
            ]}
          />
        )
      ) : (
        <>
          {categories.length === 0 ? (
            <EmptyState title={t('emptyCategoriesTitle')} description={t('emptyCategoriesDescription')} />
          ) : (
            <Table
              caption={t('tabs.categories')}
              rowKey={(r) => r.id}
              rows={categories}
              columns={[
                {
                  key: 'title',
                  header: tc('columns.title'),
                  cell: (r: HelpCategoryDto) => (
                    <span className="flex flex-col">
                      <Link href={`/o/${org}/help-center/categories/${r.id}`} className="underline underline-offset-2">
                        {r.title}
                      </Link>
                      <span dir="ltr" className="font-mono text-caption text-zinc-500">
                        /help/{r.slug}
                      </span>
                    </span>
                  ),
                },
                { key: 'audience', header: t('fields.audience'), cell: (r: HelpCategoryDto) => t(`audience.${r.audience}`) },
                { key: 'position', header: t('fields.position'), mono: true, align: 'end', cell: (r: HelpCategoryDto) => String(r.position) },
              ]}
            />
          )}
          {canWrite ? (
            <Card className="flex flex-col gap-4">
              <h2 className="text-[19px] font-normal">{t('newCategory')}</h2>
              <CategoryForm
                action={createCategoryAction.bind(null, org)}
                locales={LOCALES.filter((l) => l !== 'en').map((code) => ({ code, name: localeName(code) }))}
                submitLabel={t('createCategory')}
              />
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
