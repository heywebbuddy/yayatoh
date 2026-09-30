import { CMS_WRITE, listHelpQuery } from '@yayatoh/cms';
import { LOCALES } from '@yayatoh/contracts';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArticleEditor } from '@/components/help/article-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createArticleAction } from '../actions.ts';

/** A new help article (a draft until published). Viewers and other orgs are refused. */
export default async function NewHelpArticle({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org)) notFound();
  const data = await loadConsole(org);
  if (!roleCan(data.role, CMS_WRITE)) notFound();
  const t = await getTranslations('helpConsole');
  const { categories } = await executeQuery(listHelpQuery, {}, data.ctx, ports);
  const localeName = (l: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
  return (
    <>
      <PageHeader title={t('newArticle')} description={t('newArticleDescription')} />
      <Link href={`/o/${org}/help-center`} className="self-start text-body underline">
        {t('back')}
      </Link>
      <Card>
        <ArticleEditor
          action={createArticleAction.bind(null, org)}
          categories={categories.map((c) => ({
            id: c.id,
            title: c.title,
            audienceLabel: t(`audience.${c.audience}`),
          }))}
          locales={LOCALES.map((code) => ({ code, name: localeName(code) }))}
          slugFrozen={false}
          submitLabel={t('createArticle')}
        />
      </Card>
    </>
  );
}
