import { getReportScheduleQuery } from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReportScheduleForm } from '@/components/analytics-pro-forms.tsx';
import { AnalyticsTabs } from '@/components/analytics-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { hourLabels, reportRecipients } from '@/server/analytics-pro.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { updateScheduleAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyticsPro.reports');
  return { title: t('editTitle') };
}

/** Edit a scheduled report (M6.2b; owners and admins). */
export default async function EditSchedulePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; scheduleId: string }>;
}) {
  const { locale, org, scheduleId } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'org:update')) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(scheduleId)) notFound();
  const t = await getTranslations('analyticsPro.reports');
  const s = await executeQuery(getReportScheduleQuery, { scheduleId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const events = await executeQuery(listEventsQuery, {}, data.ctx, ports);
  const members = await reportRecipients(data, (name) => t('you', { name }));
  return (
    <>
      <PageHeader title={t('editTitle')} description={s.name} />
      <AnalyticsTabs org={org} current="reports" />
      <Link
        href={`/o/${org}/analytics/reports`}
        className="min-h-6 self-start text-body font-semibold text-primary"
      >
        {t('back')}
      </Link>
      <ReportScheduleForm
        action={updateScheduleAction.bind(null, org, s.id)}
        mode="edit"
        events={events.map((e) => ({ id: e.id, name: e.name }))}
        members={members}
        hours={hourLabels(locale)}
        timeZone={s.timeZone}
        initial={{
          name: s.name,
          frequency: s.frequency,
          sendHour: s.sendHour,
          eventId: s.eventId ?? '',
          recipients: s.recipients,
        }}
      />
    </>
  );
}
