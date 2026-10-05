import { audienceExportBulk, getSegmentQuery } from '@yayatoh/audiences';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceBuilder } from '@/components/audience-builder.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  deleteAudienceAction,
  eventTicketTypesAction,
  exportAudienceAction,
  previewAudienceAction,
  saveAudienceAction,
} from '../actions.ts';
import { builderData } from '../builder-data.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audiences');
  return { title: t('title') };
}

const UUID = /^[0-9a-f-]{36}$/;

/** A saved audience: edit it in the builder, export it (bulk export path) or delete it. */
export default async function AudiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; segment: string }>;
  searchParams: Promise<{ saved?: string; export?: string }>;
}) {
  const { locale, org, segment } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'messages:read') || !UUID.test(segment))
    notFound();
  const sp = await searchParams;
  const t = await getTranslations('audiences');
  let saved: Awaited<ReturnType<typeof loadSegment>>;
  try {
    saved = await loadSegment(data, segment);
  } catch (err) {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'invalid_state')) notFound();
    throw err;
  }
  const { events, series } = await builderData(data, locale);
  const canSave = roleCan(data.role, 'messages:send');
  const canExport = roleCan(data.role, 'attendees:export');
  const op = sp.export && UUID.test(sp.export) ? sp.export : null;
  const exported = op
    ? await executeQuery(audienceExportBulk.status, { operationId: op }, data.ctx, ports).catch(() => null)
    : null;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={saved.name}
        actions={
          <>
            {canExport ? (
              <StepUpForm action={exportAudienceAction.bind(null, org, saved.id)}>
                <Button type="submit" variant="secondary">
                  {t('export.start')}
                </Button>
              </StepUpForm>
            ) : null}
            {canSave ? (
              <form action={deleteAudienceAction.bind(null, org, saved.id)}>
                <Button type="submit" variant="ghost" aria-label={t('deleteFor', { name: saved.name })}>
                  {t('delete')}
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.saved ? <Alert tone="info" title={t('save.done')} /> : null}
        {exported ? (
          exported.status === 'done' ? (
            <Alert tone="info" title={t('export.ready', { count: exported.succeeded })}>
              <a
                href={`${locale === 'en' ? '' : `/${locale}`}/o/${org}/audiences/exports/${exported.id}`}
                className={buttonClass('secondary', 'sm')}
              >
                {t('export.download')}
              </a>
            </Alert>
          ) : (
            <Alert
              tone="info"
              title={t('export.running', { processed: exported.processed, total: exported.total })}
            />
          )
        ) : null}
      </div>
      <AudienceBuilder
        initial={saved.definition}
        segmentId={saved.id}
        name={saved.name}
        events={events}
        series={series}
        currency={data.org.currency}
        canSave={canSave}
        template={null}
        preview={previewAudienceAction.bind(null, org)}
        ticketTypes={eventTicketTypesAction.bind(null, org)}
        canMoney={roleCan(data.role, 'finance:read')}
        contactsHref={roleCan(data.role, 'contacts:read') ? `/o/${org}/contacts` : null}
        save={saveAudienceAction.bind(null, org, saved.id)}
      />
    </>
  );
}

function loadSegment(data: Awaited<ReturnType<typeof loadConsole>>, segmentId: string) {
  return executeQuery(getSegmentQuery, { segmentId }, data.ctx, ports);
}
