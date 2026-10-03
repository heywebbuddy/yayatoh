import { displayLinksQuery } from '@yayatoh/command-center';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, PageHeader, SectionHeader, StatusPill, Tag } from '@yayatoh/ui';
import { MonitorPlay } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DisplayLinkForm } from '@/components/command-center/display-link-form.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createDisplayLinkAction, revokeDisplayLinkAction } from './actions.ts';

/**
 * TV mode links (M3.3a): read-only boards for venue screens. Staff who can edit the event create
 * and turn off links; anyone who can read the event sees the list.
 */
export default async function TvLinksPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'commandCenter');
  const t = await getTranslations('commandCenter.tv');
  const tc = await getTranslations('commandCenter');
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tc('title'), href: `/o/${org}/e/${event}/command-center` },
        { label: t('title') },
      ]}
    />
  );
  if (!roleCan(data.role, 'events:read') || !data.modules.has('checkin'))
    return (
      <>
        <PageHeader breadcrumb={crumbs} title={t('title')} description={ev.name} />
        <EmptyState title={t('noAccessTitle')} description={t('noAccess')} />
      </>
    );
  const canManage = roleCan(data.role, 'events:write');
  const links = await executeQuery(displayLinksQuery, { eventId: ev.id }, data.ctx, ports);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  return (
    <>
      <PageHeader
        breadcrumb={crumbs}
        title={t('title')}
        tag={<Tag>{t('readOnly')}</Tag>}
        description={t('description', { event: ev.name })}
      />
      {canManage ? (
        <section aria-labelledby="tv-new" className="flex flex-col gap-3">
          <SectionHeader id="tv-new" title={t('newTitle')} />
          <DisplayLinkForm action={createDisplayLinkAction.bind(null, org, event)} />
        </section>
      ) : null}
      <section aria-labelledby="tv-list" className="flex flex-col gap-3">
        <SectionHeader id="tv-list" title={t('listTitle')} count={links.length} />
        {links.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <Card className="p-0!">
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="tv-links">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary-ink"
                  >
                    <MonitorPlay className="size-5" strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body font-bold text-ink">{l.label}</span>
                    <span className="text-caption text-ink-2 tabular-nums">
                      {l.revokedAt
                        ? t('revokedAt', { time: date.format(l.revokedAt) })
                        : t('createdAt', { time: date.format(l.createdAt) })}
                    </span>
                  </span>
                  <StatusPill
                    tone={l.revokedAt ? 'neutral' : 'success'}
                    label={l.revokedAt ? t('statusOff') : t('statusOn')}
                  />
                  {canManage && !l.revokedAt ? (
                    <form action={revokeDisplayLinkAction.bind(null, org, event, l.id)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t('revokeLabel', { label: l.label })}
                      >
                        {t('revoke')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}
