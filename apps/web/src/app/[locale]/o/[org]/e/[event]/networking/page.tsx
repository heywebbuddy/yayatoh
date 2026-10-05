import {
  LOCATION_KINDS,
  MAX_LOCATION_CAPACITY,
  matchmakingStatusQuery,
  networkConsoleQuery,
} from '@yayatoh/engagement';
import { executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { navIncludes } from '@yayatoh/platform';
import { Button, Card, EmptyState, PageHeader, StatCard, StatusPill } from '@yayatoh/ui';
import { Handshake } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { slotLabel } from '@/components/networking/format.ts';
import { MatchmakingCard } from '@/components/networking/matchmaking-card.tsx';
import { ActionButton, NetworkToasts } from '@/components/networking/network-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { aiDrafter } from '@/server/ai.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addSlotsAction,
  deleteLocationAction,
  deleteSlotAction,
  enableAction,
  refreshMatchmakingAction,
  resolveReportAction,
  restoreAction,
  saveLocationAction,
  settingsAction,
} from './actions.ts';
import { ChatConsole } from './chat-console.tsx';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

export async function generateMetadata() {
  const t = await getTranslations('networking.console');
  return { title: t('title') };
}

/**
 * Networking for organizers (M5.8a): turn it on, meeting locations with their capacity and time
 * slots, the report queue and hidden people. Organizers never see the directory or anyone's
 * requests. Viewers see it read-only.
 */
export default async function NetworkingConsolePage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, profile, can } = await loadEvent(org, event, 'sessions');
  if (!navIncludes(profile, data.modules, 'sessions')) notFound();
  const canWrite = can('events:write');
  const t = await getTranslations('networking.console');
  const tn = await getTranslations('networking');
  const tr = await getTranslations();
  const c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, data.ctx, ports);
  const tz = ev.timezone;
  // M6.12b: matchmaking (AI embeddings of opted-in profiles), when the org has the AI module.
  const matchmaking =
    c.settings.enabled && data.modules.has('ai')
      ? await executeQuery(matchmakingStatusQuery, { eventId: ev.id }, data.ctx, ports)
      : null;
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tr('nav.sessions'), href: `/o/${org}/e/${event}/sessions` },
        { label: t('title') },
      ]}
    />
  );
  const isPublic = ev.status === 'published' && ev.visibility !== 'private';
  const errors = {
    name: t('errors.name'),
    'conflict.name': t('errors.nameTaken'),
    capacity: t('errors.capacity', { max: MAX_LOCATION_CAPACITY }),
    capacity_below_booked: t('errors.capacityBelowBooked'),
    startsAt: t('errors.startsAt'),
    endsAt: t('errors.endsAt'),
    minutes: t('errors.minutes'),
    before_start: t('errors.endsAt'),
    outside_event: t('errors.outsideEvent'),
    too_short: t('errors.tooShort'),
    overlap: t('errors.overlap'),
    too_many: t('errors.tooMany'),
  };
  const kinds = LOCATION_KINDS.map((k) => ({ value: k, label: tn(`kind.${k}`) }));
  const open = c.reports.filter((r) => r.status === 'open');
  const closed = c.reports.filter((r) => r.status !== 'open');
  const dateTime = new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
  return (
    <NetworkToasts closeLabel={tn('close')}>
      <PageHeader
        breadcrumb={crumbs}
        title={t('title')}
        description={t('description')}
        actions={
          c.settings.enabled && isPublic ? (
            <Link
              href={`/events/${ev.slug}/network`}
              className="inline-flex min-h-10 items-center underline underline-offset-2"
            >
              {t('openAttendeePage')}
            </Link>
          ) : undefined
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}
      {!c.settings.enabled ? (
        <EmptyState
          icon={<Handshake />}
          title={t('offTitle')}
          description={canWrite ? t('offDescription') : t('offViewer')}
          action={
            canWrite ? (
              <form action={enableAction.bind(null, org, event)}>
                <Button type="submit">{t('enable')}</Button>
              </form>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={t('stats.optedIn')} value={c.stats.optedIn} />
          <StatCard label={t('stats.connections')} value={c.stats.connections} />
          <StatCard label={t('stats.meetings')} value={c.stats.meetings} />
        </div>
      )}
      {c.settings.enabled && canWrite ? (
        <Card className="flex flex-col gap-3" aria-labelledby="net-settings">
          <h2 id="net-settings" className="text-section">
            {t('settings')}
          </h2>
          <ProgramForm
            action={settingsAction.bind(null, org, event)}
            idPrefix="net-settings"
            submitLabel={t('saveSettings')}
            successLabel={t('settingsSaved')}
            errors={{}}
            fields={[
              {
                kind: 'checkboxes',
                name: 'switches',
                label: t('switches'),
                options: [
                  { value: 'enabled', label: t('enabledLabel') },
                  { value: 'meetings', label: t('meetingsLabel') },
                  { value: 'chat', label: t('chatLabel') },
                ],
                defaultValues: [
                  'enabled',
                  ...(c.settings.meetingsEnabled ? ['meetings'] : []),
                  ...(c.settings.chatEnabled ? ['chat'] : []),
                ],
              },
            ]}
          />
        </Card>
      ) : null}

      {matchmaking ? (
        <Card>
          <section aria-labelledby="net-matchmaking" className="flex flex-col gap-3">
            <h2 id="net-matchmaking" className="text-section">
              {tr('networking.matchmaking.title')}
            </h2>
            <MatchmakingCard
              listed={matchmaking.listed}
              embedded={matchmaking.embedded}
              enabled={aiDrafter() !== null}
              canWrite={canWrite}
              refresh={refreshMatchmakingAction.bind(null, org, event)}
            />
          </section>
        </Card>
      ) : null}
      <section aria-labelledby="net-locations" className="flex flex-col gap-3">
        <h2 id="net-locations" className="text-section">
          {t('locations')}
        </h2>
        <p className="text-body text-ink-2">{t('locationsHelp')}</p>
        {c.locations.length === 0 ? (
          <p className="text-body text-ink-2">{t('noLocations')}</p>
        ) : (
          <ul aria-label={t('locations')} className="flex list-none flex-col gap-2 p-0">
            {c.locations.map((l) => (
              <li key={l.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-card">{l.name}</h3>
                      <p className="text-body text-ink-2">
                        {tn(`kind.${l.kind}`)} · {t('capacityShort', { count: l.capacity })} ·{' '}
                        {t('bookedShort', { count: l.booked })}
                      </p>
                    </div>
                    {canWrite ? (
                      <ActionButton
                        action={deleteLocationAction.bind(null, org, event, l.id)}
                        label={t('delete')}
                        accessibleName={t('deleteLocation', { name: l.name })}
                        done={t('locationDeleted')}
                        variant="ghost"
                      />
                    ) : null}
                  </div>
                  {canWrite ? (
                    <details>
                      <summary className="min-h-10 cursor-pointer content-center font-bold">
                        {t('editLocation', { name: l.name })}
                      </summary>
                      <div className="pt-3">
                        <ProgramForm
                          action={saveLocationAction.bind(null, org, event, l.id)}
                          idPrefix={`loc-${l.id}`}
                          submitLabel={t('saveLocation')}
                          successLabel={t('locationSaved')}
                          errors={errors}
                          fields={[
                            {
                              kind: 'text',
                              name: 'name',
                              label: t('locationName'),
                              required: true,
                              maxLength: 80,
                              defaultValue: l.name,
                            },
                            {
                              kind: 'select',
                              name: 'kind',
                              label: t('locationKind'),
                              options: kinds,
                              defaultValue: l.kind,
                            },
                            {
                              kind: 'number',
                              name: 'capacity',
                              label: t('capacity'),
                              hint: t('capacityHint'),
                              defaultValue: String(l.capacity),
                            },
                          ]}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3" role="region" aria-labelledby="net-add-location">
            <h3 id="net-add-location" className="text-card">
              {t('addLocation')}
            </h3>
            <ProgramForm
              action={saveLocationAction.bind(null, org, event, null)}
              idPrefix="loc-new"
              submitLabel={t('addLocation')}
              successLabel={t('locationAdded')}
              errors={errors}
              reset
              fields={[
                {
                  kind: 'text',
                  name: 'name',
                  label: t('locationName'),
                  hint: t('locationNameHint'),
                  required: true,
                  maxLength: 80,
                },
                {
                  kind: 'select',
                  name: 'kind',
                  label: t('locationKind'),
                  options: kinds,
                  defaultValue: 'meeting_point',
                },
                {
                  kind: 'number',
                  name: 'capacity',
                  label: t('capacity'),
                  hint: t('capacityHint'),
                  defaultValue: '1',
                },
              ]}
            />
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="net-slots" className="flex flex-col gap-3">
        <h2 id="net-slots" className="text-section">
          {t('slots')}
        </h2>
        <p className="text-body text-ink-2">{t('slotsHelp', { timezone: tz.replace(/_/g, ' ') })}</p>
        {c.slots.length === 0 ? (
          <p className="text-body text-ink-2">{t('noSlots')}</p>
        ) : (
          <ul aria-label={t('slots')} className="flex list-none flex-col gap-2 p-0">
            {c.slots.map((s) => {
              const label = slotLabel(locale, tz, s.startsAt, s.endsAt);
              return (
                <li key={s.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-body font-bold text-ink">{label}</span>
                      <span className="text-caption text-ink-2">{t('bookedShort', { count: s.booked })}</span>
                    </div>
                    {canWrite ? (
                      <ActionButton
                        action={deleteSlotAction.bind(null, org, event, s.id)}
                        label={t('delete')}
                        accessibleName={t('deleteSlot', { slot: label })}
                        done={t('slotDeleted')}
                        variant="ghost"
                      />
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3" role="region" aria-labelledby="net-add-slots">
            <h3 id="net-add-slots" className="text-card">
              {t('addSlots')}
            </h3>
            <ProgramForm
              action={addSlotsAction.bind(null, org, event)}
              idPrefix="slots-new"
              submitLabel={t('addSlots')}
              successLabel={t('slotsAdded')}
              errors={errors}
              fields={[
                {
                  kind: 'datetime-local',
                  name: 'startsAt',
                  label: t('slotsFrom'),
                  required: true,
                  hint: t('timeHint', { timezone: tz.replace(/_/g, ' ') }),
                  defaultValue: utcToZonedInput(ev.startsAt, tz),
                },
                { kind: 'datetime-local', name: 'endsAt', label: t('slotsTo'), required: true },
                {
                  kind: 'number',
                  name: 'minutes',
                  label: t('slotMinutes'),
                  hint: t('slotMinutesHint'),
                  defaultValue: '15',
                },
              ]}
            />
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="net-reports" className="flex flex-col gap-3">
        <h2 id="net-reports" className="text-section">
          {t('reports')}
        </h2>
        {open.length === 0 ? (
          <p className="text-body text-ink-2">{t('noReports')}</p>
        ) : (
          <ul aria-label={t('openReports')} className="flex list-none flex-col gap-2 p-0">
            {open.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-card">
                    {t('reportTitle', { reported: r.reported.displayName, reporter: r.reporter.displayName })}
                  </h3>
                  <p className="text-body text-ink-2">
                    {tn(`reasons.${r.reason}`)} · {dateTime.format(r.createdAt)}
                  </p>
                  {r.details ? (
                    <blockquote className="border-s-2 border-line-strong ps-3 text-body text-ink">
                      {r.details}
                    </blockquote>
                  ) : null}
                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        action={resolveReportAction.bind(null, org, event, r.id, 'hide')}
                        label={t('hide')}
                        accessibleName={t('hideName', { name: r.reported.displayName })}
                        done={t('hidden', { name: r.reported.displayName })}
                        variant="danger"
                      />
                      <ActionButton
                        action={resolveReportAction.bind(null, org, event, r.id, 'dismiss')}
                        label={t('dismiss')}
                        accessibleName={t('dismissReport', { name: r.reported.displayName })}
                        done={t('dismissed')}
                      />
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {closed.length ? (
          <details>
            <summary className="min-h-10 cursor-pointer content-center font-bold">
              {t('closedReports', { count: closed.length })}
            </summary>
            <ul className="flex list-none flex-col gap-2 p-0 pt-3">
              {closed.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-body">
                  <StatusPill
                    tone={r.status === 'hidden' ? 'danger' : 'neutral'}
                    label={t(`status.${r.status}`)}
                  />
                  {t('reportTitle', { reported: r.reported.displayName, reporter: r.reporter.displayName })}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {c.settings.enabled ? (
        <ChatConsole
          org={org}
          event={event}
          eventId={ev.id}
          ctx={data.ctx}
          canWrite={canWrite}
          locale={locale}
          timeZone={tz}
        />
      ) : null}

      <section aria-labelledby="net-hidden" className="flex flex-col gap-3">
        <h2 id="net-hidden" className="text-section">
          {t('hiddenPeople')}
        </h2>
        {c.hidden.length === 0 ? (
          <p className="text-body text-ink-2">{t('noHidden')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {c.hidden.map((h) => (
              <li key={h.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-body font-bold text-ink">{h.displayName}</span>
                  {canWrite ? (
                    <ActionButton
                      action={restoreAction.bind(null, org, event, h.id)}
                      label={t('restore')}
                      accessibleName={t('restoreName', { name: h.displayName })}
                      done={t('restored', { name: h.displayName })}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </NetworkToasts>
  );
}
