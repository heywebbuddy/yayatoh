import { displayLinksQuery } from '@yayatoh/command-center';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DisplayLinkForm } from '@/components/command-center/display-link-form.tsx';
import { Link } from '@/i18n/navigation.ts';
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
  const back = (
    <Link href={`/o/${org}/e/${event}/command-center`} className="text-body underline">
      {t('back')}
    </Link>
  );
  if (!roleCan(data.role, 'events:read') || !data.modules.has('checkin'))
    return (
      <>
        <PageHeader title={t('title')} description={ev.name} />
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
      <PageHeader title={t('title')} description={t('description', { event: ev.name })} />
      {back}
      {canManage ? (
        <section aria-labelledby="tv-new" className="flex flex-col gap-3">
          <h2 id="tv-new" className="text-section">
            {t('newTitle')}
          </h2>
          <DisplayLinkForm action={createDisplayLinkAction.bind(null, org, event)} />
        </section>
      ) : null}
      <section aria-labelledby="tv-list" className="flex flex-col gap-3">
        <h2 id="tv-list" className="text-section">
          {t('listTitle')}
        </h2>
        {links.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <Card size="panel">
            <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0" data-testid="tv-links">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block">{l.label}</span>
                    <span className="text-caption text-zinc-600">
                      {l.revokedAt
                        ? t('revokedAt', { time: date.format(l.revokedAt) })
                        : t('createdAt', { time: date.format(l.createdAt) })}
                    </span>
                  </span>
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
