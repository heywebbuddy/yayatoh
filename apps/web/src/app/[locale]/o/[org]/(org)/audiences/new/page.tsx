import { TEMPLATE_KEYS, type TemplateKey } from '@yayatoh/audiences';
import { SegmentDefinition } from '@yayatoh/audiences/client';
import { roleCan } from '@yayatoh/tenancy';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceBuilder } from '@/components/audience-builder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { decodeSuggestion } from '@/lib/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { eventTicketTypesAction, previewAudienceAction, saveAudienceAction } from '../actions.ts';
import { builderData } from '../builder-data.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audiences');
  return { title: t('newTitle') };
}

/**
 * Build a new audience, blank, from one of the vision templates (`?template=`) or from an AI
 * suggestion to review (`?suggestion=`, M6.12b: a segment definition, checked like any other).
 */
export default async function NewAudiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ template?: string; suggestion?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'messages:read')) notFound();
  const { template: raw, suggestion } = await searchParams;
  const suggested = suggestion
    ? SegmentDefinition.safeParse(decodeSuggestion(suggestion.slice(0, 20_000)))
    : null;
  const initial = suggested?.success ? suggested.data : null;
  const template =
    !initial && (TEMPLATE_KEYS as readonly string[]).includes(raw ?? '') ? (raw as TemplateKey) : null;
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
      {initial ? <p className="text-body text-ink-2">{t('ai.reviewNotice')}</p> : null}
      {suggestion && !initial ? (
        <p role="alert" className="text-body text-danger">
          {t('ai.invalidSuggestion')}
        </p>
      ) : null}
      <AudienceBuilder
        initial={initial}
        segmentId={null}
        name=""
        events={events}
        series={series}
        currency={data.org.currency}
        canSave={roleCan(data.role, 'messages:send')}
        template={template}
        preview={previewAudienceAction.bind(null, org)}
        ticketTypes={eventTicketTypesAction.bind(null, org)}
        canMoney={roleCan(data.role, 'finance:read')}
        contactsHref={roleCan(data.role, 'contacts:read') ? `/o/${org}/contacts` : null}
        save={saveAudienceAction.bind(null, org, null)}
      />
    </>
  );
}
