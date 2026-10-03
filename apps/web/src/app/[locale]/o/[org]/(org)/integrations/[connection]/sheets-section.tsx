import { listEventsQuery } from '@yayatoh/events';
import { sheetLinksQuery } from '@yayatoh/integrations';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { Alert, Button, buttonClass, EmptyState, SectionHeader, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { linkSheetAction, unlinkSheetAction } from '../connector-actions.ts';
import { LinkSheetForm } from './link-sheet-form.tsx';

/**
 * Google Sheets (M6.4b): the events whose attendee lists sync with a sheet, linking another one
 * and unlinking (with a confirmation step). Owners and admins change it; managers see it.
 */
export async function SheetsSection({
  org,
  connectionId,
  ctx,
  locale,
  timezone,
  canManage,
  active,
  confirm,
}: {
  org: string;
  connectionId: string;
  ctx: Ctx;
  locale: string;
  timezone: string;
  canManage: boolean;
  active: boolean;
  confirm: string | null;
}) {
  const t = await getTranslations('integrations.sheets');
  const [links, events] = await Promise.all([
    executeQuery(sheetLinksQuery, { connectionId }, ctx, ports),
    canManage && active ? executeQuery(listEventsQuery, {}, ctx, ports) : Promise.resolve([]),
  ]);
  const linked = new Set(links.filter((l) => l.status === 'active').map((l) => l.eventId));
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone });
  const linkable = events
    .filter((e) => !linked.has(e.id) && e.status !== 'archived')
    .map((e) => ({
      id: e.id,
      label: `${e.name} · ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: e.timezone }).format(e.startsAt)}`,
    }));
  const confirming = links.find((l) => l.status === 'active' && confirm === `unlink-${l.id}`) ?? null;
  return (
    <section aria-labelledby="sheets-heading" className="flex flex-col gap-3">
      <SectionHeader id="sheets-heading" title={t('title')} description={t('help')} count={linked.size} />
      {confirming && canManage ? (
        <Alert tone="warning" title={t('confirmUnlink', { event: confirming.eventName })}>
          <p className="m-0">{t('confirmUnlinkBody')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={unlinkSheetAction.bind(null, org, connectionId, confirming.id)}>
              <Button type="submit" variant="danger">
                {t('unlink')}
              </Button>
            </form>
            <Link href={`/o/${org}/integrations/${connectionId}`} className={buttonClass('ghost')}>
              {t('keep')}
            </Link>
          </div>
        </Alert>
      ) : null}
      {canManage && active ? (
        linkable.length ? (
          <LinkSheetForm events={linkable} action={linkSheetAction.bind(null, org, connectionId)} />
        ) : (
          <p className="m-0 text-body text-ink-2">{events.length ? t('allLinked') : t('noEvents')}</p>
        )
      ) : null}
      {links.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={canManage ? t('emptyHelp') : t('emptyReadOnly')} />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(l) => l.id}
          rows={links}
          stackOnPhone
          columns={[
            { key: 'event', header: t('event'), cell: (l) => l.eventName },
            {
              key: 'sheet',
              header: t('sheet'),
              cell: (l) => (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  aria-label={t('openNamed', { title: l.title })}
                >
                  {l.title}
                </a>
              ),
            },
            { key: 'linked', header: t('linkedOn'), cell: (l) => day.format(l.createdAt) },
            {
              key: 'status',
              header: t('status'),
              cell: (l) => (
                <StatusPill
                  tone={l.status === 'active' ? 'success' : 'neutral'}
                  label={t(`statuses.${l.status}`)}
                />
              ),
            },
            ...(canManage
              ? [
                  {
                    key: 'actions',
                    header: t('actions'),
                    align: 'end' as const,
                    cell: (l: (typeof links)[number]) =>
                      l.status === 'active' ? (
                        <Link
                          href={`/o/${org}/integrations/${connectionId}?confirm=unlink-${l.id}`}
                          className={buttonClass('ghost', 'sm')}
                          aria-label={t('unlinkNamed', { event: l.eventName })}
                        >
                          {t('unlink')}
                        </Link>
                      ) : (
                        '—'
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </section>
  );
}
