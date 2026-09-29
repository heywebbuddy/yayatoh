import { executeQuery } from '@yayatoh/kernel';
import { announcementsQuery } from '@yayatoh/messaging';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AnnouncementComposer } from '@/components/announcement-composer.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { composerAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('announcements');
  return { title: t('title') };
}

/** Marketing: announcements to the event's attendees (compose, preview, send), the sent log, and a way to its surveys. */
export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  if (!data.modules.has('messaging') || !roleCan(data.role, 'messages:read')) notFound();
  const t = await getTranslations('announcements');
  const ts = await getTranslations('surveys');
  const tn = await getTranslations('notifications');
  const log = await executeQuery(announcementsQuery, { eventId: ev.id }, data.ctx, ports);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { event: ev.name })} />
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-body font-medium">{ts('title')}</span>
          <span className="text-caption text-zinc-600">{ts('marketingHint')}</span>
        </span>
        <Link href={`/o/${org}/e/${event}/marketing/surveys`} className={buttonClass('secondary', 'sm')}>
          {ts('open')}
        </Link>
      </Card>
      {roleCan(data.role, 'messages:send') ? (
        <section aria-labelledby="compose-heading" className="flex flex-col gap-3">
          <h2 id="compose-heading" className="text-section">
            {t('composeTitle')}
          </h2>
          <Card>
            <AnnouncementComposer action={composerAction.bind(null, org, event)} />
          </Card>
        </section>
      ) : null}
      <section aria-labelledby="sent-heading" className="flex flex-col gap-3">
        <h2 id="sent-heading" className="text-section">
          {t('sentTitle')}
        </h2>
        <Table
          caption={t('sentTitle')}
          rowKey={(a) => a.id}
          rows={log}
          empty={t('sentEmpty')}
          columns={[
            { key: 'when', header: t('sentAt'), cell: (a) => when.format(a.sentAt) },
            {
              key: 'subject',
              header: t('subject'),
              cell: (a) => (
                <span className="flex flex-col">
                  <span>{a.subject}</span>
                  <span className="line-clamp-2 text-caption text-zinc-500">{a.body}</span>
                </span>
              ),
            },
            {
              key: 'channels',
              header: t('channels'),
              cell: (a) => a.channels.map((c) => t(`channel.${c}`)).join(', '),
            },
            {
              key: 'recipients',
              header: t('recipients'),
              cell: (a) => a.recipients,
              mono: true,
              align: 'end',
            },
            {
              key: 'delivery',
              header: t('delivery'),
              cell: (a) => (
                <span className="flex flex-col gap-0.5">
                  <span>{t('deliveryCounts', a.delivery)}</span>
                  {a.reasons.length ? (
                    <span className="flex flex-col text-caption text-zinc-600">
                      <span className="sr-only">{t('reasonsLabel')}</span>
                      {a.reasons.map((r) => (
                        <span key={`${r.channel}:${r.reason}`}>
                          {t('reasonLine', {
                            channel: tn(`channels.${r.channel}`),
                            reason: tn.has(`reasons.${r.reason}`) ? tn(`reasons.${r.reason}`) : r.reason,
                            count: r.count,
                          })}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
