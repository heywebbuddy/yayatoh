import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { listVenuesQuery } from '@yayatoh/venues';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EventWizard } from '@/components/event-wizard.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { guidedCreateAction } from '../actions.ts';

/** The three-step event wizard (M1.4f). The one-page form stays at `/events/new`. */
export default async function GuidedNewEventPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations('wizard');
  const venues = await executeQuery(listVenuesQuery, {}, data.ctx, ports);
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
      <EventWizard
        action={guidedCreateAction.bind(null, org)}
        defaults={{ profile: data.profile, timezone: data.org.timezone }}
        venues={venues.map((v) => ({ id: v.id, name: v.name, city: v.city }))}
        currency={data.org.currency}
        ticketing={data.modules.has('ticketing')}
      />
    </>
  );
}
