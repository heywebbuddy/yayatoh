import { SAMPLE_CODE } from '@yayatoh/badges';
import { qrPath } from '@yayatoh/pdf';
import { Alert, buttonClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeDesigner } from '@/components/badge-designer.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { loadBadgesPage } from '@/server/badges.ts';
import { saveTemplateAction } from '../actions.ts';

/** The badge template designer (M5.5a). Viewers see the live preview, read-only. */
export default async function BadgeDesignerPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; templateId: string }>;
}) {
  const { locale, org, event, templateId } = await params;
  setRequestLocale(locale);
  const { data, ev, setup, canWrite } = await loadBadgesPage(org, event);
  const template = setup.templates.find((x) => x.id === templateId);
  if (!template) notFound();
  const tb = await getTranslations('badges');
  const tn = await getTranslations('nav');
  const base = `/o/${org}/e/${event}/badges`;
  // Route handlers (PDFs) are linked directly: the default locale has no prefix.
  const raw = `${locale === 'en' ? '' : `/${locale}`}${base}`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tn('badges'), href: base },
              { label: template.name },
            ]}
          />
        }
        actions={
          <>
            <a href={`${raw}/preview/${template.id}?lang=en`} className={buttonClass('secondary')}>
              {tb('previewPdfEnglish', { name: template.name })}
            </a>
            <a href={`${raw}/preview/${template.id}?lang=ar`} className={buttonClass('secondary')}>
              {tb('previewPdfArabic', { name: template.name })}
            </a>
          </>
        }
        title={
          canWrite
            ? tb('designerTitle', { name: template.name })
            : tb('previewTitle', { name: template.name })
        }
        description={tb('designerSubtitle')}
      />
      {canWrite ? null : <Alert tone="info" title={tb('viewerNotice')} />}
      <BadgeDesigner
        template={{
          id: template.id,
          name: template.name,
          version: template.version,
          design: template.design,
        }}
        ticketTypes={setup.ticketTypes.filter((x) => !x.archived)}
        questions={setup.questions}
        canWrite={canWrite}
        sampleQr={qrPath(SAMPLE_CODE)}
        save={saveTemplateAction.bind(null, org, event, template.id)}
      />
    </>
  );
}
