import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { enrollmentOverviewQuery } from '@yayatoh/registration';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionHeader,
  StatusPill,
} from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { PromoteNow } from '@/components/promote-now.tsx';
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
  const tv = await getTranslations('vocab');
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
  const summary =
    'inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-caption font-bold text-primary-ink hover:bg-surface-3';
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tv('registration'), href: `/o/${org}/e/${event}/registration` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('subtitle')}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="enrollment-sessions-heading" className="flex flex-col gap-3">
        <SectionHeader id="enrollment-sessions-heading" title={t('sessions')} description={t('closeRule')} />
        {optional.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Link href={`/o/${org}/e/${event}/sessions`} className={buttonClass('secondary')}>
                {t('openSessions')}
              </Link>
            }
          />
        ) : (
          <ul className="grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
            {optional.map((s) => {
              const places =
                s.capacity === null
                  ? t('placesUnlimited', { enrolled: s.enrolled })
                  : t('places', { enrolled: s.enrolled, capacity: s.capacity });
              return (
                <li key={s.sessionId} className="flex">
                  <Card className="flex w-full flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <CardHeader as="h3" title={s.title} />
                      <p className="m-0 text-caption text-ink-2 tabular-nums">
                        {when.format(s.startsAt)}
                        {s.roomName ? ` · ${s.roomName}` : ''}
                        {s.groupName ? ` · ${t('group', { name: s.groupName })}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <p className="m-0 text-body font-bold text-ink tabular-nums">{places}</p>
                      {s.capacity !== null ? (
                        <ProgressBar
                          value={Math.min(s.enrolled, s.capacity)}
                          max={s.capacity}
                          label={places}
                          tone={s.enrolled >= s.capacity ? 'warning' : 'primary'}
                        />
                      ) : null}
                      <p className="m-0 text-caption text-ink-2 tabular-nums">
                        {s.waiting + s.offered > 0
                          ? t('waitlist', { waiting: s.waiting, offered: s.offered })
                          : t('noWaitlist')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.enrollmentOpen ? null : <StatusPill tone="neutral" label={t('enrollmentClosed')} />}
                      {s.promotionOpen ? (
                        <StatusPill
                          tone="info"
                          label={t('closesAt', { when: when.format(s.promotionClosesAt) })}
                        />
                      ) : (
                        <StatusPill tone="waiting" label={t('closed')} />
                      )}
                    </div>
                    {canWrite && s.promotionOpen ? (
                      <PromoteNow
                        action={promoteNowAction.bind(null, org, event, s.sessionId)}
                        title={s.title}
                        waiting={s.waiting}
                      />
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="enrollment-settings-heading" className="flex flex-col gap-3">
        <SectionHeader id="enrollment-settings-heading" title={t('settings')} />
        <Card size="panel" className="flex flex-col gap-3">
          {canWrite ? (
            <ProgramForm
              action={saveEnrollmentSettingsAction.bind(null, org, event)}
              fields={settingsFields}
              idPrefix="enrollment-settings"
              submitLabel={t('saveSettings')}
              successLabel={t('saved')}
              errors={errors}
            />
          ) : (
            <p className="m-0 text-body text-ink">
              {overview.settings.promotion === 'auto'
                ? t('promotionAuto')
                : t('offerSummary', { minutes: overview.settings.offerMinutes })}
            </p>
          )}
        </Card>
      </section>

      <section aria-labelledby="enrollment-items-heading" className="flex flex-col gap-3">
        <SectionHeader id="enrollment-items-heading" title={t('items')} description={t('itemsHint')} />
        {overview.items.length === 0 ? (
          <EmptyState
            title={tr('noItems')}
            action={
              <Link href={`/o/${org}/e/${event}/registration`} className={buttonClass('secondary')}>
                {t('backToRegistration')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {overview.items.map((i) => (
              <li key={i.admissionItemId}>
                <Card className="flex flex-col gap-2">
                  <CardHeader as="h3" title={i.name} />
                  <p className="m-0 text-caption text-ink-2">
                    {tr(`kind.${i.kind}`)} ·{' '}
                    {i.all
                      ? t('allSessions')
                      : i.sessionIds.length === 0
                        ? t('noSessions')
                        : t('someSessions', { count: i.sessionIds.length })}
                  </p>
                  {canWrite && sessionOptions.length > 0 ? (
                    <details className="border-t border-line pt-2">
                      <summary className={summary}>{t('chooseSessions', { name: i.name })}</summary>
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
