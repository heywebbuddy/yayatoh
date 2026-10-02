import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { enrollmentOverviewQuery } from '@yayatoh/registration';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { promoteNowAction, saveEnrollmentSettingsAction, saveItemSessionsAction } from './actions.ts';

/**
 * Session enrollment (M5.2b), under Registration: per optional session the places taken, the
 * waitlist (waiting and offered) with "Promote now", the event's waitlist setting (enrol at once
 * or offer for a window; P5-9 stops promotion 24 h before each session), and which sessions each
 * admission item gives. Keyboard-only by construction; viewers read it.
 */
export default async function EnrollmentPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'registration')) notFound();
  const overview = await executeQuery(enrollmentOverviewQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = roleCan(data.role, 'events:write');
  const t = await getTranslations('enrollment');
  const tr = await getTranslations('registration');
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: overview.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const errors: Record<string, string> = {
    offerMinutes: t('errors.offerMinutes'),
    promotion: t('errors.promotion'),
    sessionIds: t('errors.sessionIds'),
    promotion_closed: t('errors.promotion_closed'),
  };
  const optional = overview.sessions.filter((s) => s.admission === 'optional');
  const settingsFields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'promotion',
      label: t('promotion'),
      options: [
        { value: 'auto', label: t('promotionAuto') },
        { value: 'offer', label: t('promotionOffer') },
      ],
      defaultValue: overview.settings.promotion,
    },
    {
      kind: 'number',
      name: 'offerMinutes',
      label: t('offerMinutes'),
      hint: t('offerMinutesHint'),
      defaultValue: String(overview.settings.offerMinutes),
    },
  ];
  const sessionOptions = overview.sessions.map((s) => ({
    value: s.sessionId,
    label: `${s.title} · ${when.format(s.startsAt)}`,
  }));
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Link
        href={`/o/${org}/e/${event}/registration`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('backToRegistration')}
      </Link>
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}

      <section aria-labelledby="enrollment-sessions-heading" className="flex flex-col gap-3">
        <h2 id="enrollment-sessions-heading" className="text-section">
          {t('sessions')}
        </h2>
        <p className="text-body text-zinc-600">{t('closeRule')}</p>
        {optional.length === 0 ? (
          <Card className="flex flex-col gap-3">
            <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
            <Link
              href={`/o/${org}/e/${event}/sessions`}
              className="self-start text-body underline underline-offset-2"
            >
              {t('openSessions')}
            </Link>
          </Card>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {optional.map((s) => (
              <li key={s.sessionId}>
                <Card className="flex flex-col gap-2" data-session={s.title}>
                  <h3 className="text-body font-medium">{s.title}</h3>
                  <p className="text-caption text-zinc-600">
                    {when.format(s.startsAt)}
                    {s.roomName ? ` · ${s.roomName}` : ''}
                    {s.groupName ? ` · ${t('group', { name: s.groupName })}` : ''}
                  </p>
                  <p className="text-body">
                    {s.capacity === null
                      ? t('placesUnlimited', { enrolled: s.enrolled })
                      : t('places', { enrolled: s.enrolled, capacity: s.capacity })}
                  </p>
                  <p className="text-caption text-zinc-600">
                    {s.waiting + s.offered > 0
                      ? t('waitlist', { waiting: s.waiting, offered: s.offered })
                      : t('noWaitlist')}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {s.enrollmentOpen ? null : <StatusDot status="neutral" label={t('enrollmentClosed')} />}
                    {s.promotionOpen ? (
                      <StatusDot
                        status="info"
                        label={t('closesAt', { when: when.format(s.promotionClosesAt) })}
                      />
                    ) : (
                      <StatusDot status="warning" label={t('closed')} />
                    )}
                  </div>
                  {canWrite && s.waiting > 0 && s.promotionOpen ? (
                    <ProgramForm
                      action={promoteNowAction.bind(null, org, event, s.sessionId)}
                      fields={[]}
                      idPrefix={`promote-${s.sessionId}`}
                      submitLabel={t('promoteNow', { title: s.title })}
                      successLabel={t('promoted')}
                      errors={errors}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="enrollment-settings-heading" className="flex flex-col gap-3">
        <h2 id="enrollment-settings-heading" className="text-section">
          {t('settings')}
        </h2>
        {canWrite ? (
          <Card size="panel" className="flex flex-col gap-3">
            <ProgramForm
              action={saveEnrollmentSettingsAction.bind(null, org, event)}
              fields={settingsFields}
              idPrefix="enrollment-settings"
              submitLabel={t('saveSettings')}
              successLabel={t('saved')}
              errors={errors}
            />
          </Card>
        ) : (
          <p className="text-body">
            {overview.settings.promotion === 'auto'
              ? t('promotionAuto')
              : t('offerSummary', { minutes: overview.settings.offerMinutes })}
          </p>
        )}
      </section>

      <section aria-labelledby="enrollment-items-heading" className="flex flex-col gap-3">
        <h2 id="enrollment-items-heading" className="text-section">
          {t('items')}
        </h2>
        <p className="text-body text-zinc-600">{t('itemsHint')}</p>
        {overview.items.length === 0 ? (
          <p className="text-body text-zinc-500">{tr('noItems')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {overview.items.map((i) => (
              <li key={i.admissionItemId}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">{i.name}</h3>
                  <p className="text-caption text-zinc-600">
                    {tr(`kind.${i.kind}`)} ·{' '}
                    {i.all
                      ? t('allSessions')
                      : i.sessionIds.length === 0
                        ? t('noSessions')
                        : t('someSessions', { count: i.sessionIds.length })}
                  </p>
                  {canWrite && sessionOptions.length > 0 ? (
                    <details>
                      <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                        {t('chooseSessions', { name: i.name })}
                      </summary>
                      <div className="pt-3">
                        <ProgramForm
                          action={saveItemSessionsAction.bind(null, org, event, i.admissionItemId)}
                          fields={[
                            {
                              kind: 'checkboxes',
                              name: 'sessionIds',
                              label: t('itemSessions', { name: i.name }),
                              options: sessionOptions,
                              defaultValues: i.sessionIds,
                            },
                          ]}
                          idPrefix={`item-sessions-${i.admissionItemId}`}
                          submitLabel={t('saveItem', { name: i.name })}
                          successLabel={t('saved')}
                          errors={errors}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
