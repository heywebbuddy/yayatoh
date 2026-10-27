import { listSeriesQuery, orgCategoriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { listVenuesQuery } from '@yayatoh/venues';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EventWizard } from '@/components/event-wizard.tsx';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { categoryLabels } from '@/server/event-categories.ts';
import { ports } from '@/server/ports.ts';
import { pickerProfiles } from '@/server/profile-picker.ts';
import { createVenueInlineAction } from '../../../venues/actions.ts';
import { guidedCreateAction } from '../actions.ts';

/** The three-step event wizard (M1.4f). The one-page form stays at `/events/new`. */
export default async function GuidedNewEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  /** U7: `?series={id}` picks the series in advance. */
  searchParams: Promise<{ series?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations('wizard');
  const [venues, series, categories] = await Promise.all([
    executeQuery(listVenuesQuery, {}, data.ctx, ports),
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
    executeQuery(orgCategoriesQuery, {}, data.ctx, ports),
  ]);
  const tg = await getTranslations();
  const categoryLabel = await categoryLabels((key) => tg(`categories.${key}`));
  const preset = series.find((s) => s.id === sp.series)?.id;
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href={`/o/${org}/events/new`} className={buttonClass('secondary')}>
            {t('quickCreate')}
          </Link>
        }
      />
      <HowItWorks topic="eventType" />
      <EventWizard
        action={guidedCreateAction.bind(null, org)}
        defaults={{
          profile: data.profile,
          timezone: data.org.timezone,
          ...(preset ? { series: preset } : {}),
        }}
        series={series.map((s) => ({ id: s.id, name: s.name }))}
        venues={venues.map((v) => ({ id: v.id, name: v.name, city: v.city, timezone: v.timezone }))}
        createVenue={createVenueInlineAction.bind(null, org)}
        currency={data.org.currency}
        ticketing={data.modules.has('ticketing')}
        profiles={await pickerProfiles(data.modules)}
        categories={categories.map((c) => ({ ref: c.ref, label: c.name ?? categoryLabel(c.platformKey) }))}
        manageCategoriesHref={roleCan(data.role, 'org:update') ? `/o/${org}/settings/categories` : undefined}
      />
    </>
  );
}
