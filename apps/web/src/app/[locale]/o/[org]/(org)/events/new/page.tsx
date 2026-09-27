import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CreateEventForm } from '@/components/create-event-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { createEventAction } from './actions.ts';

export default async function NewEventPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations('newEvent');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href={`/o/${org}/templates`} className={buttonClass('secondary')}>
            {t('fromTemplate')}
          </Link>
        }
      />
      <CreateEventForm
        action={createEventAction.bind(null, org)}
        defaults={{ profile: data.profile, timezone: data.org.timezone }}
      />
    </>
  );
}
