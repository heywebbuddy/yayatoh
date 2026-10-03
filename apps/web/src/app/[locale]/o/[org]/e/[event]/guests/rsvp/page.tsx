import { guestListQuery, PARTY_RSVP_STATES, rsvpOverviewQuery } from '@yayatoh/guests';
import { executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createRsvpLinksAction, saveRsvpSettingsAction } from './actions.ts';
import { rsvpFindUrl } from './links.ts';

const pill = 'rounded-pill px-2 py-px text-caption';

/**
 * RSVP (M4.1d): the event's deadline and paper-fallback switch, how many parties are at each
 * step (invited → sent → viewed → responded), and links and PINs for every party. Each party's
 * link, QR code and PIN are on its own page. `guests:write` edits; viewers read.
 */
export default async function RsvpHostPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('rsvpHost');
  const canWrite = can('guests:write');
  const [ov, list] = await Promise.all([
    executeQuery(rsvpOverviewQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(guestListQuery, { eventId: ev.id, limit: 1 }, data.ctx, ports),
  ]);
  const names = new Map(list.partyOptions.map((p) => [p.id, p.name]));
  const n = (v: number) => formatNumber(v, locale);
  const withoutLink = ov.parties.filter((p) => !p.hasLink).length;
  const subName = new Map(ov.subEvents.map((s) => [s.id, s.name]));
  const deadline = ov.settings.deadline
    ? new Intl.DateTimeFormat(locale, {
        timeZone: ev.timezone,
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(ov.settings.deadline)
    : null;
  const base = `/o/${org}/e/${event}/guests`;

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Link href={base} className="min-h-6 self-start py-1 text-caption underline">
        {t('back')}
      </Link>
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}

      <section aria-labelledby="rsvp-states-heading" className="flex flex-col gap-3">
        <h2 id="rsvp-states-heading" className="text-section">
          {t('statesTitle')}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PARTY_RSVP_STATES.map((s) => (
            <Card key={s} className="flex flex-col gap-1">
              <dt className="text-caption text-ink-2">{t(`states.${s}`)}</dt>
              <dd className="text-section tabular-nums">{n(ov.states[s] ?? 0)}</dd>
            </Card>
          ))}
        </dl>
        {canWrite && withoutLink > 0 ? (
          <Card size="panel" className="flex flex-col gap-3">
            <p className="text-body">{t('linksMissing', { count: withoutLink })}</p>
            <ProgramForm
              action={createRsvpLinksAction.bind(null, org, event, null)}
              fields={[]}
              idPrefix="rsvp-links"
              submitLabel={t('createLinks')}
              successLabel={t('linksCreated')}
              errors={{}}
            />
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="rsvp-settings-heading" className="flex flex-col gap-3">
        <h2 id="rsvp-settings-heading" className="text-section">
          {t('settingsTitle')}
        </h2>
        <Card size="panel" className="flex flex-col gap-3">
          <p className="text-body">
            {deadline ? t('deadlineIs', { deadline }) : t('noDeadline')}
            {ov.locked ? ` ${t('deadlinePassed')}` : ''}
          </p>
          <p className="text-body">{ov.settings.nameLookup ? t('lookupOn') : t('lookupOff')}</p>
          {ov.settings.nameLookup && ov.settings.lookupCode ? (
            <p className="text-caption text-ink-2">
              {t('lookupAddress')}{' '}
              <span data-testid="rsvp-find-url" dir="ltr" className="font-mono break-all text-ink">
                {rsvpFindUrl(ov.settings.lookupCode)}
              </span>
            </p>
          ) : null}
          {canWrite ? (
            <ProgramForm
              action={saveRsvpSettingsAction.bind(null, org, event)}
              fields={[
                {
                  kind: 'datetime-local',
                  name: 'deadline',
                  label: t('deadline', { zone: ev.timezone }),
                  hint: t('deadlineHint'),
                  defaultValue: ov.settings.deadline
                    ? utcToZonedInput(ov.settings.deadline, ev.timezone)
                    : '',
                },
                {
                  kind: 'checkboxes',
                  name: 'nameLookup',
                  label: t('lookupLegend'),
                  options: [{ value: '1', label: t('lookupLabel') }],
                  defaultValues: ov.settings.nameLookup ? ['1'] : [],
                },
              ]}
              idPrefix="rsvp-settings"
              submitLabel={t('saveSettings')}
              successLabel={t('settingsSaved')}
              errors={{ deadline: t('errors.deadline') }}
            />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="rsvp-parties-heading" className="flex flex-col gap-3">
        <h2 id="rsvp-parties-heading" className="text-section">
          {t('partiesTitle')}
        </h2>
        {ov.subEvents.length === 0 ? (
          <EmptyState
            title={t('noSubEventsTitle')}
            description={t('noSubEvents')}
            action={
              <Link href={`${base}/sub-events`} className="min-h-6 py-1 text-caption underline">
                {t('subEventsLink')}
              </Link>
            }
          />
        ) : null}
        {ov.parties.length === 0 ? (
          <EmptyState title={t('noPartiesTitle')} description={t('noParties')} />
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {ov.parties.map((p) => {
              const name = names.get(p.partyId) ?? '';
              return (
                <li key={p.partyId}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-body font-medium">{name}</h3>
                      <span className={`${pill} bg-surface-3 text-ink-2`}>{t(`states.${p.state}`)}</span>
                      {p.reopened ? (
                        <span className={`${pill} bg-primary-soft text-primary-ink`}>{t('reopened')}</span>
                      ) : null}
                    </div>
                    {p.subEvents.length ? (
                      <ul className="flex list-none flex-col gap-0.5 p-0 text-caption text-ink-2">
                        {p.subEvents.map((s) => (
                          <li key={s.subEventId}>
                            {t('tally', {
                              name: subName.get(s.subEventId) ?? '',
                              attending: s.attending,
                              declined: s.declined,
                              awaiting: s.awaiting,
                            })}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-caption text-ink-2">{t('notInvited')}</p>
                    )}
                    <Link
                      href={`${base}/rsvp/${p.partyId}`}
                      className="min-h-6 self-start py-1 text-caption underline"
                    >
                      {canWrite ? t('openParty', { party: name }) : t('viewParty', { party: name })}
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
