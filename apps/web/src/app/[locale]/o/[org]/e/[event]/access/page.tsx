import { eventDetailsQuery, listAccessCodesQuery, privateInfoQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessCodeForm } from '@/components/access-code-form.tsx';
import { PrivateInfoForm } from '@/components/private-info-form.tsx';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createAccessCodeAction, savePrivateInfoAction, setAccessCodeActiveAction } from './actions.ts';

export default async function AccessPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const title = <PageHeader title={t('access.title')} description={t('access.subtitle')} />;
  // Private info and codes are secrets: people who can't edit the event don't see them at all.
  if (!canWrite)
    return (
      <>
        {title}
        <EmptyState title={t('access.viewerTitle')} description={t('access.viewerDescription')} />
      </>
    );
  const codesEnabled = data.modules.has('access_codes');
  const [info, details, codes, types] = await Promise.all([
    executeQuery(privateInfoQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports),
    codesEnabled ? executeQuery(listAccessCodesQuery, { eventId: ev.id }, data.ctx, ports) : [],
    data.modules.has('ticketing')
      ? executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports)
      : [],
  ]);
  const hidden = types.filter((p) => p.visibility === 'hidden' && !p.archivedAt);
  const passName = new Map(types.map((p) => [p.id, p.name]));
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const now = new Date();
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return (
    <>
      {title}
      <section aria-labelledby="private-info-heading" className="flex flex-col gap-3">
        <h2 id="private-info-heading" className="text-section">
          {t('privateInfo.heading')}
        </h2>
        <p className="text-body text-zinc-500">{t('privateInfo.explainer')}</p>
        <Card size="panel">
          <PrivateInfoForm
            action={savePrivateInfoAction.bind(null, org, event)}
            info={info}
            online={details.attendanceMode !== 'in_person'}
          />
        </Card>
      </section>
      {codesEnabled ? (
        <section aria-labelledby="access-codes-heading" className="flex flex-col gap-3">
          <h2 id="access-codes-heading" className="text-section">
            {t('accessCodes.heading')}
          </h2>
          <p className="text-body text-zinc-500">{t('accessCodes.explainer')}</p>
          {ev.visibility === 'private' ? (
            <p className="text-body break-all" data-testid="unlock-link">
              {t('accessCodes.unlockLink', { url: `${origin}/events/${ev.slug}/unlock` })}
            </p>
          ) : null}
          {codes.length === 0 ? (
            <EmptyState title={t('accessCodes.emptyTitle')} description={t('accessCodes.emptyDescription')} />
          ) : (
            <Table
              caption={t('accessCodes.caption')}
              rowKey={(c) => c.id}
              rows={codes}
              columns={[
                { key: 'code', header: t('accessCodes.code'), cell: (c) => c.code, mono: true },
                { key: 'label', header: t('accessCodes.label'), cell: (c) => c.label ?? '—' },
                {
                  key: 'unlocks',
                  header: t('accessCodes.unlocks'),
                  cell: (c) =>
                    [
                      ...(c.unlocksEvent ? [t('accessCodes.eventPage')] : []),
                      ...c.ticketTypeIds.map((id) => passName.get(id) ?? '—'),
                    ].join(', '),
                },
                {
                  key: 'uses',
                  header: t('accessCodes.uses'),
                  cell: (c) =>
                    c.maxUses === null
                      ? formatNumber(c.uses, locale)
                      : `${formatNumber(c.uses, locale)} / ${formatNumber(c.maxUses, locale)}`,
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'expires',
                  header: t('accessCodes.expires'),
                  cell: (c) => (c.expiresAt ? when.format(c.expiresAt) : t('accessCodes.never')),
                },
                {
                  key: 'status',
                  header: t('accessCodes.status'),
                  cell: (c) =>
                    !c.active ? (
                      <StatusDot status="neutral" label={t('accessCodes.inactive')} />
                    ) : c.expiresAt && c.expiresAt <= now ? (
                      <StatusDot status="warning" label={t('accessCodes.expired')} />
                    ) : c.maxUses !== null && c.uses >= c.maxUses ? (
                      <StatusDot status="warning" label={t('accessCodes.usedUp')} />
                    ) : (
                      <StatusDot status="success" label={t('accessCodes.active')} />
                    ),
                },
                {
                  key: 'actions',
                  header: t('accessCodes.actions'),
                  cell: (c) => (
                    <form action={setAccessCodeActiveAction.bind(null, org, event, c.id, !c.active)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {c.active
                          ? t('accessCodes.deactivate', { code: c.code })
                          : t('accessCodes.activate', { code: c.code })}
                      </Button>
                    </form>
                  ),
                },
              ]}
            />
          )}
          <Card size="panel" className="flex flex-col gap-3">
            <h3 className="text-section">{t('accessCodes.new')}</h3>
            <AccessCodeForm
              action={createAccessCodeAction.bind(null, org, event)}
              hiddenPasses={hidden.map((p) => ({ id: p.id, name: p.name }))}
              isPrivate={ev.visibility === 'private'}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
