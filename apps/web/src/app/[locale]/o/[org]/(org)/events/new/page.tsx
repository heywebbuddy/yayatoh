import { listSeriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CreateEventForm } from '@/components/create-event-form.tsx';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { pickerProfiles } from '@/server/profile-picker.ts';
import { createEventAction } from './actions.ts';

export default async function NewEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  /** U7: `?series={id}` picks the series in advance ("Create event in this series"). */
  searchParams: Promise<{ series?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations('newEvent');
  const series = await executeQuery(listSeriesQuery, {}, data.ctx, ports);
  const preset = series.find((s) => s.id === sp.series)?.id;
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link
              href={`/o/${org}/events/new/guided${preset ? `?series=${preset}` : ''}`}
              className={buttonClass('primary')}
            >
              {t('guided')}
            </Link>
            <Link href={`/o/${org}/templates`} className={buttonClass('secondary')}>
              {t('fromTemplate')}
            </Link>
          </>
        }
      />
      <HowItWorks topic="eventType" />
      <CreateEventForm
        action={createEventAction.bind(null, org)}
        defaults={{
          profile: data.profile,
          timezone: data.org.timezone,
          currency: data.org.currency,
          ...(preset ? { series: preset } : {}),
        }}
        series={series.map((s) => ({ id: s.id, name: s.name }))}
        profiles={await pickerProfiles(data.modules)}
      />
    </>
  );
}
