import { CMS_WRITE, getHelpArticleQuery, listHelpQuery } from '@yayatoh/cms';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EntryControls } from '@/components/cms/entry-controls.tsx';
import { ArticleEditor } from '@/components/help/article-editor.tsx';
import { helpArticlePath } from '@/components/help/help-views.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin } from '@/server/seo.ts';
import { articleStatusAction, deleteArticleAction, updateArticleAction } from '../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** Edit one help article: publish / unpublish / archive / delete, fields with a preview. */
export default async function HelpArticleConsole({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; article: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, org, article: articleId } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org) || !UUID.test(articleId)) notFound();
  const data = await loadConsole(org);
  const article = await executeQuery(getHelpArticleQuery, { articleId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const { categories } = await executeQuery(listHelpQuery, {}, data.ctx, ports);
  const category = categories.find((c) => c.id === article.categoryId);
  const t = await getTranslations('helpConsole');
  const tc = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const publicUrl =
    article.status === 'published' && category
      ? `${apexOrigin(await requestHost())}${localizedPath(article.locale, helpArticlePath(category.slug, article.slug))}`
      : null;
  const act = (a: 'publish' | 'unpublish' | 'archive') => articleStatusAction.bind(null, org, article.id, a);
  return (
    <>
      <PageHeader
        eyebrow={new Intl.DisplayNames([locale], { type: 'language' }).of(article.locale) ?? article.locale}
        title={article.title}
        description={category?.title}
      />
      <Link href={`/o/${org}/help-center`} className="self-start text-body underline">
        {t('back')}
      </Link>
      {(await searchParams).created ? <Alert tone="info" title={tc('created')} /> : null}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot status={DOT[article.status]} label={tc(`status.${article.status}`)} />
          {publicUrl ? (
            <a href={publicUrl} className="text-body underline" dir="ltr">
              {tc('viewPublic')}
            </a>
          ) : null}
        </div>
        {canWrite ? (
          <EntryControls
            status={article.status}
            title={article.title}
            publish={act('publish')}
            unpublish={act('unpublish')}
            archive={act('archive')}
            remove={deleteArticleAction.bind(null, org, article.id)}
          />
        ) : null}
      </Card>
      {canWrite ? (
        <Card>
          <ArticleEditor
            action={updateArticleAction.bind(null, org, article.id)}
            categories={categories.map((c) => ({ id: c.id, title: c.title, audienceLabel: t(`audience.${c.audience}`) }))}
            locales={null}
            slugFrozen={article.publishedAt !== null}
            submitLabel={tc('save')}
            values={{
              categoryId: article.categoryId,
              locale: article.locale,
              slug: article.slug,
              title: article.title,
              summary: article.summary ?? '',
              body: article.body,
              keywords: article.keywords ?? '',
              position: article.position,
              seoTitle: article.seoTitle ?? '',
              seoDescription: article.seoDescription ?? '',
            }}
          />
        </Card>
      ) : (
        <Card>
          <article aria-label={tc('previewLabel')} className="flex flex-col gap-3">
            {article.summary ? <p className="text-body text-zinc-600">{article.summary}</p> : null}
            <Markdown source={article.body} />
          </article>
        </Card>
      )}
    </>
  );
}
