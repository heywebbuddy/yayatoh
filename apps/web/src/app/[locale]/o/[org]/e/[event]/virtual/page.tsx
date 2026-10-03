import { virtualCheckpointsQuery } from '@yayatoh/checkin';
import { listConnectionsQuery } from '@yayatoh/integrations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatCard, StatusPill, Table } from '@yayatoh/ui';
import { virtualSetupQuery, zoomSetupQuery } from '@yayatoh/virtual';
import { CalendarClock, Ticket } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { AccessForm, DeliveryForm, StreamControls } from '@/components/virtual/stream-setup.tsx';
import { ZoomSyncButton, ZoomWebinarForm } from '@/components/virtual/zoom-setup.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  createStreamAction,
  linkZoomAction,
  revealStreamKeyAction,
  setAccessAction,
  setDeliveryAction,
  setStreamEnabledAction,
  syncZoomAction,
} from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('virtual.setup');
  return { title: t('title') };
}

/**
 * Stream setup (M6.9a): how the event is delivered (in person, online, hybrid), what each ticket
 * type gives (in person, online or both), and a live stream per program session with its watch
 * time and virtual check-ins. Totals only: never who watched. Read with `events:read`; editors
 * (`events:write`) change it.
 */
export default async function VirtualPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'virtual');
  if (!data.modules.has('virtual') || !can('events:read')) notFound();
  const t = await getTranslations('virtual.setup');
  const tz = await getTranslations('virtual.zoom');
  const tr = await getTranslations();
  const setup = await executeQuery(virtualSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const checkpoints = data.modules.has('checkin')
    ? await executeQuery(virtualCheckpointsQuery, { eventId: ev.id }, data.ctx, ports).catch((err) => {
        if (isDomainError(err)) return [];
        throw err;
      })
    : [];
  const checkedIn = new Map(checkpoints.map((c) => [c.sessionId, c.checkedIn]));
  // M6.9b: Zoom webinars per session, and whether the org's Zoom connection is live (members who
  // can't read integrations see the section without the connection's state).
  const zoomSetup = await executeQuery(zoomSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const zoomConnected = data.modules.has('integrations')
    ? await executeQuery(listConnectionsQuery, {}, data.ctx, ports)
        .then((cs) => cs.some((c) => c.connector === 'zoom' && c.status === 'active'))
        .catch((err) => {
          if (isDomainError(err)) return null;
          throw err;
        })
    : null;
  const canEdit = can('events:write');
  const streaming = setup.deliveryMode !== 'in_person';
  const canStream = streaming && setup.provider !== null;
  const nf = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const viewers = setup.sessions.reduce((n, s) => n + s.viewers, 0);
  const minutes = setup.sessions.reduce((n, s) => n + s.minutes, 0);
  const sessionsHref = `/o/${org}/e/${event}/sessions`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tr('nav.virtual') },
            ]}
          />
        }
        title={t('title')}
        description={t('description', { event: ev.name })}
      />
      {setup.provider === null ? (
        <Alert tone="warning" title={t('providerOff')}>
          {t('providerOffHint')}
        </Alert>
      ) : setup.provider === 'fake' ? (
        <Alert tone="info" title={t('fakeProvider')} />
      ) : null}
      {!canEdit ? <Alert tone="info" title={t('readOnly')} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label={t('totalViewers')} value={nf.format(viewers)} testId="virtual-viewers" />
        <StatCard label={t('totalMinutes')} value={nf.format(minutes)} testId="virtual-minutes" />
      </div>
      <Card>
        <h2 className="m-0 mb-3 text-section">{t('deliveryTitle')}</h2>
        <DeliveryForm
          value={setup.deliveryMode}
          canEdit={canEdit}
          save={setDeliveryAction.bind(null, org, event)}
        />
      </Card>
      <Card>
        <h2 className="m-0 mb-1 text-section">{t('accessTitle')}</h2>
        <p className="mt-0 mb-3 text-caption text-ink-2">{t('accessHint')}</p>
        {!streaming ? (
          <Alert tone="info" title={t('inPersonNote')} />
        ) : setup.ticketTypes.length === 0 ? (
          <EmptyState
            icon={<Ticket />}
            title={t('noTicketTypes')}
            description={t('noTicketTypesHint')}
            action={
              <Link href={`/o/${org}/e/${event}/tickets-orders`} className={buttonClass('secondary')}>
                {t('addTicketTypes')}
              </Link>
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {setup.ticketTypes.map((tt) => (
              <li key={tt.ticketTypeId} className="border-line border-b pb-4 last:border-b-0 last:pb-0">
                <AccessForm
                  name={tt.name}
                  value={tt.access}
                  effective={tt.effective}
                  canEdit={canEdit}
                  save={setAccessAction.bind(null, org, event, tt.ticketTypeId)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="flex flex-col gap-3">
        <h2 className="m-0 text-section">{t('sessionsTitle')}</h2>
        {setup.sessions.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title={t('noSessions')}
            description={t('noSessionsHint')}
            action={
              <Link href={sessionsHref} className={buttonClass('secondary')}>
                {t('addSessions')}
              </Link>
            }
          />
        ) : (
          <Table
            caption={t('sessionsTitle')}
            rowKey={(s) => s.sessionId}
            rows={setup.sessions}
            stackOnPhone
            columns={[
              {
                key: 'title',
                header: t('session'),
                cell: (s) => (
                  <span className="flex flex-col">
                    <span className="font-medium">{s.title}</span>
                    <span className="text-caption text-ink-2">{when.format(s.startsAt)}</span>
                  </span>
                ),
              },
              {
                key: 'stream',
                header: t('stream'),
                cell: (s) =>
                  !s.stream ? (
                    <StatusPill tone="neutral" label={t('streamNone')} />
                  ) : s.stream.enabled ? (
                    <StatusPill tone="success" label={t('streamOn')} />
                  ) : (
                    <StatusPill tone="waiting" label={t('streamOff')} />
                  ),
              },
              { key: 'viewers', header: t('viewers'), align: 'end', cell: (s) => nf.format(s.viewers) },
              { key: 'minutes', header: t('minutes'), align: 'end', cell: (s) => nf.format(s.minutes) },
              {
                key: 'checkedIn',
                header: t('checkedIn'),
                align: 'end',
                cell: (s) => nf.format(checkedIn.get(s.sessionId) ?? 0),
              },
              ...(canEdit
                ? [
                    {
                      key: 'actions',
                      header: t('actions'),
                      cell: (s: (typeof setup.sessions)[number]) => (
                        <StreamControls
                          title={s.title}
                          hasStream={s.stream !== null}
                          enabled={s.stream?.enabled ?? false}
                          canEdit={canEdit}
                          canStream={canStream}
                          create={createStreamAction.bind(null, org, event, s.sessionId)}
                          toggle={setStreamEnabledAction.bind(
                            null,
                            org,
                            event,
                            s.sessionId,
                            !s.stream?.enabled,
                          )}
                          reveal={revealStreamKeyAction.bind(null, org, event, s.sessionId)}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {setup.sessions.length > 0 && !streaming ? (
          <p className="m-0 text-caption text-ink-2">{t('inPersonNote')}</p>
        ) : null}
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="zoom-heading">
        <h2 id="zoom-heading" className="m-0 text-section">
          {tz('title')}
        </h2>
        <p className="m-0 text-caption text-ink-2">{tz('intro')}</p>
        {zoomConnected === false ? (
          <Alert tone="info" title={tz('notConnected')}>
            <Link href={`/o/${org}/integrations`} className="underline underline-offset-2">
              {tz('connectLink')}
            </Link>
          </Alert>
        ) : null}
        {!streaming ? (
          <p className="m-0 text-caption text-ink-2">{t('inPersonNote')}</p>
        ) : zoomSetup.sessions.length === 0 ? null : (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {zoomSetup.sessions.map((s) => (
                <li key={s.sessionId}>
                  <Card>
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <h3 className="m-0 text-body font-semibold">{s.title}</h3>
                        <span className="text-caption text-ink-2">{when.format(s.startsAt)}</span>
                      </div>
                      {s.webinarId ? (
                        <span className="text-caption text-ink-2" data-testid="zoom-counts">
                          {tz('counts', { registrants: s.registrants, attendees: s.attendees })}
                        </span>
                      ) : (
                        <StatusPill tone="neutral" label={tz('notLinked')} />
                      )}
                    </div>
                    <ZoomWebinarForm
                      title={s.title}
                      webinarId={s.webinarId}
                      canEdit={canEdit}
                      save={linkZoomAction.bind(null, org, event, s.sessionId)}
                    />
                  </Card>
                </li>
              ))}
            </ul>
            {canEdit && zoomSetup.sessions.some((s) => s.webinarId) ? (
              <ZoomSyncButton sync={syncZoomAction.bind(null, org, event)} />
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
