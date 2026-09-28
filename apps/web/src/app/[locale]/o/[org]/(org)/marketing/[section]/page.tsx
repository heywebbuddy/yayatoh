import { CMS_WRITE, getSiteSectionQuery } from '@yayatoh/cms';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EntryControls } from '@/components/cms/entry-controls.tsx';
import { SectionEditor } from '@/components/marketing/section-editor.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deleteSectionAction, sectionStatusAction, updateSectionAction } from '../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** Edit one marketing section: publish / unpublish / archive / delete and its fields. */
export default async function SectionConsole({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; section: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, org, section: sectionId } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org) || !UUID.test(sectionId)) notFound();
  const data = await loadConsole(org);
  const section = await executeQuery(getSiteSectionQuery, { sectionId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations('siteConsole');
  const tc = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const act = (a: 'publish' | 'unpublish' | 'archive') => sectionStatusAction.bind(null, org, section.id, a);
  return (
    <>
      <PageHeader
        eyebrow={`${t(`placement.${section.placement}`)} · ${new Intl.DisplayNames([locale], { type: 'language' }).of(section.locale) ?? section.locale}`}
        title={section.heading}
      />
      <Link href={`/o/${org}/marketing`} className="self-start text-body underline">
        {t('back')}
      </Link>
      {(await searchParams).created ? <Alert tone="info" title={tc('created')} /> : null}
      <Card className="flex flex-col gap-4">
        <StatusDot status={DOT[section.status]} label={tc(`status.${section.status}`)} />
        {canWrite ? (
          <EntryControls
            status={section.status}
            title={section.heading}
            publish={act('publish')}
            unpublish={act('unpublish')}
            archive={act('archive')}
            remove={deleteSectionAction.bind(null, org, section.id)}
          />
        ) : null}
      </Card>
      {canWrite ? (
        <Card>
          <SectionEditor
            action={updateSectionAction.bind(null, org, section.id)}
            locales={null}
            submitLabel={tc('save')}
            values={{
              placement: section.placement,
              locale: section.locale,
              slug: section.slug,
              eyebrow: section.eyebrow ?? '',
              heading: section.heading,
              body: section.body,
              ctaLabel: section.ctaLabel ?? '',
              ctaHref: section.ctaHref ?? '',
              position: section.position,
            }}
          />
        </Card>
      ) : (
        <Card>
          <Markdown source={section.body} />
        </Card>
      )}
    </>
  );
}
