import { executeQuery } from '@yayatoh/kernel';
import { composeNav, PROFILE_KEYS } from '@yayatoh/platform';
import { layoutLibraryQuery } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RenameLayoutForm, StartEventForm } from '@/components/seating-library.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deleteLayoutAction, renameLayoutAction, startEventFromLayoutAction } from './actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The venue layout library (M6.11b): the org's saved floor plans (saved from an event's plan),
 * what each holds and how many events used it; start a new event from one; rename or remove one.
 * Events keep their own copy of a plan.
 */
export default async function SeatingLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ start?: string; deleted?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('seatingLibrary');
  const canWrite = roleCan(data.role, 'events:write') && roleCan(data.role, 'seating:write');
  const layouts = data.modules.has('seating')
    ? await executeQuery(layoutLibraryQuery, {}, data.ctx, ports)
    : [];
  // Profiles whose console has a seating page (given the org's modules).
  const profiles = PROFILE_KEYS.filter((p) => composeNav(p, data.modules).some((i) => i.path === 'seating'));
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const chosen = sp.start && UUID.test(sp.start) && layouts.some((l) => l.id === sp.start) ? sp.start : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {sp.deleted ? <Alert tone="info" title={t('deleted')} /> : null}
      {layouts.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={canWrite ? t('emptyHint') : t('emptyViewer')}
          action={
            <Link href={`/o/${org}/events`} className={buttonClass('secondary', 'sm')}>
              {t('toEvents')}
            </Link>
          }
        />
      ) : (
        <>
          {canWrite && profiles.length ? (
            <section aria-labelledby="start-heading" className="flex flex-col gap-3">
              <h2 id="start-heading" className="text-section">
                {t('startTitle')}
              </h2>
              <p className="text-body text-ink-2">{t('startDescription')}</p>
              <Card>
                <StartEventForm
                  key={chosen ?? 'first'}
                  layouts={layouts}
                  profiles={profiles}
                  defaults={{
                    layoutId: chosen ?? layouts[0]?.id ?? '',
                    profile: profiles.includes(data.profile as never) ? data.profile : (profiles[0] ?? ''),
                    timezone: data.org.timezone,
                  }}
                  action={startEventFromLayoutAction.bind(null, org)}
                />
              </Card>
            </section>
          ) : null}
          <section aria-labelledby="library-heading" className="flex flex-col gap-3">
            <h2 id="library-heading" className="text-section">
              {t('listTitle')}
            </h2>
            <ul className="grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
              {layouts.map((l) => (
                <li key={l.id}>
                  <Card className="flex flex-col gap-3" data-testid="library-layout">
                    <h3 className="text-body font-medium">{l.name}</h3>
                    <p className="text-caption text-ink-2">
                      {[
                        t('seats', { count: l.seatCount }),
                        l.rows ? t('rows', { count: l.rows }) : null,
                        l.tables ? t('tables', { count: l.tables }) : null,
                        l.image ? t('withImage') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-caption text-ink-2">
                      {t('usedBy', { count: l.usedBy })} · {t('updated', { date: day.format(l.updatedAt) })}
                    </p>
                    {canWrite ? (
                      <>
                        <RenameLayoutForm name={l.name} action={renameLayoutAction.bind(null, org, l.id)} />
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/o/${org}/seating-library?start=${l.id}#start-heading`}
                            className={buttonClass('secondary', 'sm')}
                            aria-label={t('startFromNamed', { name: l.name })}
                          >
                            {t('startFrom')}
                          </Link>
                          <form action={deleteLayoutAction.bind(null, org, l.id)}>
                            <Button
                              type="submit"
                              size="sm"
                              variant="ghost"
                              aria-label={t('deleteNamed', { name: l.name })}
                            >
                              {t('delete')}
                            </Button>
                          </form>
                        </div>
                      </>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
