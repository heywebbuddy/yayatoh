import { CMS_WRITE } from '@yayatoh/cms';
import { LOCALES } from '@yayatoh/contracts';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SectionEditor } from '@/components/marketing/section-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { createSectionAction } from '../actions.ts';

/** A new marketing section (a draft until published). */
export default async function NewSection({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org)) notFound();
  const data = await loadConsole(org);
  if (!roleCan(data.role, CMS_WRITE)) notFound();
  const t = await getTranslations('siteConsole');
  const localeName = (l: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
  return (
    <>
      <PageHeader title={t('newSection')} description={t('newSectionDescription')} />
      <Link href={`/o/${org}/marketing`} className="self-start text-body underline">
        {t('back')}
      </Link>
      <Card>
        <SectionEditor
          action={createSectionAction.bind(null, org)}
          locales={LOCALES.map((code) => ({ code, name: localeName(code) }))}
          submitLabel={t('createSection')}
        />
      </Card>
    </>
  );
}
