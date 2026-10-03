import { virtualCheckpointsQuery } from '@yayatoh/checkin';
import { zoomConnectedQuery } from '@yayatoh/integrations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatCard, StatusPill, Table } from '@yayatoh/ui';
import { virtualSetupQuery, zoomSetupQuery } from '@yayatoh/virtual';
import { CalendarClock, Ticket, Video } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { AccessForm, DeliveryForm, StreamControls } from '@/components/virtual/stream-setup.tsx';
import { CreateWebinarButton } from '@/components/virtual/zoom-webinars.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  createStreamAction,
  createZoomWebinarAction,
  revealStreamKeyAction,
  setAccessAction,
  setDeliveryAction,
  setIngestAction,
  setStreamEnabledAction,
  switchProviderAction,
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
  const tr = await getTranslations();
  const setup = await executeQuery(virtualSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const checkpoints = data.modules.has('checkin')
    ? await executeQuery(virtualCheckpointsQuery, { eventId: ev.id }, data.ctx, ports).catch((err) => {
        if (isDomainError(err)) return [];
        throw err;
      })
    : [];
  const checkedIn = new Map(checkpoints.map((c) => [c.sessionId, c.checkedIn]));
  // M6.10a: Zoom webinars per session, and whether the org's Zoom connection is active.
  const zoom = await executeQuery(zoomSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const zoomConnected = data.modules.has('integrations')
    ? (
        await executeQuery(zoomConnectedQuery, {}, data.ctx, ports).catch((err) => {
          if (isDomainError(err)) return { connected: false };
          throw err;
        })
      ).connected
    : false;
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
      ) : setup.providers[0]?.sandbox ? (
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
                  ) : (
                    <span className="flex flex-col items-start gap-1">
                      {s.stream.enabled ? (
                        <StatusPill tone="success" label={t('streamOn')} />
                      ) : (
                        <StatusPill tone="waiting" label={t('streamOff')} />
                      )}
                      <span className="text-caption text-ink-2" data-testid="stream-provider">
                        {t(`providerName.${s.stream.provider}`)}
                      </span>
                      {s.stream.activeIngest === 'backup' ? (
                        <StatusPill tone="waiting" label={t('backupPill')} />
                      ) : null}
                    </span>
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
                          providers={setup.providers.map((p) => ({ name: p.name }))}
                          provider={s.stream?.provider ?? null}
                          hasBackup={s.stream?.hasBackup ?? false}
                          activeIngest={s.stream?.activeIngest ?? 'primary'}
                          create={createStreamAction.bind(null, org, event, s.sessionId)}
                          switchProvider={switchProviderAction.bind(null, org, event, s.sessionId)}
                          setIngest={setIngestAction.bind(
                            null,
                            org,
                            event,
                            s.sessionId,
                            s.stream?.activeIngest === 'backup' ? 'primary' : 'backup',
                          )}
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
      {streaming && zoom.sessions.length > 0 ? (
        <Card>
          <h2 className="m-0 mb-1 text-section">{t('zoomTitle')}</h2>
          <p className="mt-0 mb-3 text-caption text-ink-2">{t('zoomHint')}</p>
          {!zoomConnected ? (
            <EmptyState
              icon={<Video />}
              title={t('zoomNotConnected')}
              description={t('zoomNotConnectedHint')}
              action={
                data.modules.has('integrations') && can('integrations:manage') ? (
                  <Link href={`/o/${org}/integrations`} className={buttonClass('secondary')}>
                    {t('connectZoom')}
                  </Link>
                ) : undefined
              }
            />
          ) : null}
          <Table
            caption={t('zoomTitle')}
            rowKey={(s) => s.sessionId}
            rows={zoom.sessions}
            stackOnPhone
            columns={[
              {
                key: 'title',
                header: t('session'),
                cell: (s) => <span className="font-medium">{s.title}</span>,
              },
              {
                key: 'webinar',
                header: t('webinar'),
                cell: (s) =>
                  s.webinarId ? (
                    <span className="flex flex-col items-start gap-1">
                      <span className="font-mono" data-testid="webinar-id">
                        {s.webinarId}
                      </span>
                      <StatusPill
                        tone={s.created ? 'success' : 'neutral'}
                        label={t(s.created ? 'webinarCreatedPill' : 'webinarLinkedPill')}
                      />
                    </span>
                  ) : (
                    <StatusPill tone="neutral" label={t('noWebinar')} />
                  ),
              },
              {
                key: 'registrants',
                header: t('registrants'),
                align: 'end',
                cell: (s) => nf.format(s.registrants),
              },
              { key: 'attendees', header: t('attendees'), align: 'end', cell: (s) => nf.format(s.attendees) },
              ...(canEdit
                ? [
                    {
                      key: 'actions',
                      header: t('actions'),
                      cell: (s: (typeof zoom.sessions)[number]) =>
                        s.webinarId ? null : (
                          <CreateWebinarButton
                            title={s.title}
                            disabled={!zoomConnected}
                            create={createZoomWebinarAction.bind(null, org, event, s.sessionId)}
                          />
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
