import { listEventsQuery, listSeriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewJourneyForm } from '@/components/journey-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createJourneyAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('journeys');
  return { title: t('newTitle') };
}

/** New journey (M3.7a): name, event or series, trigger, and blank or the vision template. */
export default async function NewJourneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:write')) notFound();
  const t = await getTranslations('journeys');
  const sp = await searchParams;
  const [events, series] = await Promise.all([
    executeQuery(listEventsQuery, {}, data.ctx, ports),
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
  ]);
  const options = [...events]
    .filter((e) => !['cancelled', 'archived'].includes(e.status))
    .sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime())
    .map((e) => ({
      id: e.id,
      name: t('form.eventOption', {
        name: e.name,
        date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: e.timezone }).format(
          e.startsAt,
        ),
      }),
    }));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/journeys`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={t('newTitle')}
        description={t('newDescription')}
      />
      <NewJourneyForm
        events={options}
        series={series.map((s) => ({ id: s.id, name: s.name }))}
        initialScope={sp.event && /^[0-9a-f-]{36}$/.test(sp.event) ? `event:${sp.event}` : ''}
        action={createJourneyAction.bind(null, org)}
      />
    </>
  );
}
