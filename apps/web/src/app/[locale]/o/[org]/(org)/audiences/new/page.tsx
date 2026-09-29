import { TEMPLATE_KEYS, type TemplateKey } from '@yayatoh/audiences';
import { roleCan } from '@yayatoh/tenancy';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceBuilder } from '@/components/audience-builder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { eventTicketTypesAction, previewAudienceAction, saveAudienceAction } from '../actions.ts';
import { builderData } from '../builder-data.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audiences');
  return { title: t('newTitle') };
}

/** Build a new audience, blank or from one of the vision templates (`?template=`). */
export default async function NewAudiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'messages:read')) notFound();
  const { template: raw } = await searchParams;
  const template = (TEMPLATE_KEYS as readonly string[]).includes(raw ?? '') ? (raw as TemplateKey) : null;
  const t = await getTranslations('audiences');
  const { events, series } = await builderData(data, locale);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={t('newTitle')}
        description={t('newDescription')}
      />
      <AudienceBuilder
        initial={null}
        segmentId={null}
        name=""
        events={events}
        series={series}
        currency={data.org.currency}
        canSave={roleCan(data.role, 'messages:send')}
        template={template}
        preview={previewAudienceAction.bind(null, org)}
        ticketTypes={eventTicketTypesAction.bind(null, org)}
        save={saveAudienceAction.bind(null, org, null)}
      />
    </>
  );
}
