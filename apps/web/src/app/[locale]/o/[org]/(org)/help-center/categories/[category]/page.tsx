import { CMS_WRITE, getHelpCategoryQuery } from '@yayatoh/cms';
import { LOCALES } from '@yayatoh/contracts';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CategoryForm } from '@/components/help/category-form.tsx';
import { DeleteControl } from '@/components/help/delete-control.tsx';
import { Link } from '@/i18n/navigation.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deleteCategoryAction, updateCategoryAction } from '../../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Edit a help category (its address is fixed); delete it once it has no articles. */
export default async function HelpCategoryConsole({
  params,
}: {
  params: Promise<{ locale: string; org: string; category: string }>;
}) {
  const { locale, org, category: categoryId } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org) || !UUID.test(categoryId)) notFound();
  const data = await loadConsole(org);
  if (!roleCan(data.role, CMS_WRITE)) notFound();
  const category = await executeQuery(getHelpCategoryQuery, { categoryId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations('helpConsole');
  const tc = await getTranslations('cms');
  const localeName = (l: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
  return (
    <>
      <PageHeader
        eyebrow={t(`audience.${category.audience}`)}
        title={category.title}
        description={`/help/${category.slug}`}
      />
      <Link href={`/o/${org}/help-center?tab=categories`} className="self-start text-body underline">
        {t('back')}
      </Link>
      <Card>
        <CategoryForm
          action={updateCategoryAction.bind(null, org, category.id)}
          locales={LOCALES.filter((l) => l !== 'en').map((code) => ({ code, name: localeName(code) }))}
          submitLabel={tc('save')}
          values={{
            audience: category.audience,
            slug: category.slug,
            title: category.title,
            description: category.description ?? '',
            position: category.position,
            translations: category.translations,
          }}
        />
      </Card>
      <Card>
        <DeleteControl
          action={deleteCategoryAction.bind(null, org, category.id)}
          title={category.title}
          refusals={{ has_articles: t('categoryHasArticles') }}
        />
      </Card>
    </>
  );
}
