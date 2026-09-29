import { SAMPLE_CODE } from '@yayatoh/badges';
import { qrPath } from '@yayatoh/pdf';
import { PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeDesigner } from '@/components/badge-designer.tsx';
import { Link } from '@/i18n/navigation.ts';
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
  const { setup, canWrite } = await loadBadgesPage(org, event);
  const template = setup.templates.find((x) => x.id === templateId);
  if (!template) notFound();
  const tb = await getTranslations('badges');
  const base = `/o/${org}/e/${event}/badges`;
  // Route handlers (PDFs) are linked directly: the default locale has no prefix.
  const raw = `${locale === 'en' ? '' : `/${locale}`}${base}`;
  return (
    <>
      <PageHeader
        title={
          canWrite
            ? tb('designerTitle', { name: template.name })
            : tb('previewTitle', { name: template.name })
        }
        description={tb('designerSubtitle')}
      />
      <p className="flex flex-wrap gap-4 text-caption">
        <Link href={base} className="underline underline-offset-2">
          {tb('backToBadges')}
        </Link>
        <a href={`${raw}/preview/${template.id}?lang=en`} className="underline underline-offset-2">
          {tb('previewPdfEnglish', { name: template.name })}
        </a>
        <a href={`${raw}/preview/${template.id}?lang=ar`} className="underline underline-offset-2">
          {tb('previewPdfArabic', { name: template.name })}
        </a>
      </p>
      {canWrite ? null : <p className="text-body text-zinc-500">{tb('viewerNotice')}</p>}
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
