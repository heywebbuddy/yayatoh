import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { finderSettingsQuery } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { finderSettingsAction } from '../actions.ts';

/**
 * Seat finder (M1.7e): open the venue map and seat finder to guests, choose how they look up
 * their seat (an emailed code, or instantly by full name), and print the poster for the door.
 */
export default async function SeatFinderSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (
    !composeNav(profile, data.modules).some((i) => i.path === 'seating') ||
    !data.modules.has('seat_finder')
  )
    notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const settings = await executeQuery(finderSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = roleCan(data.role, 'events:write');
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const publicPath = `/events/${ev.slug}/seat-finder`;
  return (
    <>
      <PageHeader title={t('finder.title')} description={t('finder.description')} />
      <SeatingTabs base={base} active="finder" finder />
      {!settings ? (
        <EmptyState
          title={t('finder.noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('assign.toPlan')}
            </Link>
          }
        />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <StatusDot
              status={settings.publicMap ? 'success' : 'neutral'}
              label={settings.publicMap ? t('finder.open') : t('finder.closed')}
            />
            <span className="text-body">
              {t('finder.modeNow', { mode: t(`finder.modeShort.${settings.mode}`) })}
            </span>
          </Card>
          {ev.status !== 'published' || ev.visibility === 'private' ? (
            <p className="text-caption text-zinc-600">{t('finder.notPublic')}</p>
          ) : null}

          <section aria-labelledby="finder-settings" className="flex flex-col gap-3">
            <h2 id="finder-settings" className="text-section">
              {t('finder.settingsTitle')}
            </h2>
            {canWrite ? (
              <Card>
                <SettingsForm
                  action={finderSettingsAction.bind(null, org, event)}
                  submitLabel={t('finder.save')}
                  savedLabel={t('finder.saved')}
                >
                  <div className="flex flex-col gap-1">
                    <label className="flex min-h-6 items-center gap-2 text-body">
                      <input
                        type="checkbox"
                        name="publicMap"
                        defaultChecked={settings.publicMap}
                        className="size-5"
                        aria-describedby="public-map-hint"
                      />
                      {t('finder.publicMap')}
                    </label>
                    <p id="public-map-hint" className="ps-7 text-caption text-zinc-600">
                      {t('finder.publicMapHint')}
                    </p>
                  </div>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-caption text-zinc-600">{t('finder.mode')}</legend>
                    {(['code', 'name'] as const).map((m) => (
                      <div key={m} className="flex flex-col gap-0.5">
                        <label className="flex min-h-6 items-center gap-2 text-body">
                          <input
                            type="radio"
                            name="mode"
                            value={m}
                            defaultChecked={settings.mode === m}
                            className="size-5"
                            aria-describedby={`mode-${m}-hint`}
                          />
                          {t(`finder.modeOption.${m}`)}
                        </label>
                        <p id={`mode-${m}-hint`} className="ps-7 text-caption text-zinc-600">
                          {t(`finder.modeHint.${m}`)}
                        </p>
                      </div>
                    ))}
                  </fieldset>
                </SettingsForm>
              </Card>
            ) : (
              <p className="text-body text-zinc-600">{t('finder.readOnly')}</p>
            )}
          </section>

          <section aria-labelledby="finder-share" className="flex flex-col gap-3">
            <h2 id="finder-share" className="text-section">
              {t('finder.shareTitle')}
            </h2>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-caption text-zinc-600">{t('finder.address')}</span>
                <span data-testid="finder-url" className="font-mono text-body break-all">
                  {`${origin}${publicPath}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={publicPath} className={buttonClass('secondary', 'sm')}>
                  {t('finder.openPublic')}
                </Link>
                <Link href={`${publicPath}/poster`} className={buttonClass('primary', 'sm')}>
                  {t('finder.poster')}
                </Link>
                {roleCan(data.role, 'attendees:read') ? (
                  <Link href={`/o/${org}/seat-poster/${event}`} className={buttonClass('secondary', 'sm')}>
                    {t('finder.namePoster')}
                  </Link>
                ) : null}
              </div>
              {settings.publicMap ? null : (
                <p className="text-caption text-zinc-600">{t('finder.closedNote')}</p>
              )}
            </Card>
          </section>
        </>
      )}
    </>
  );
}
