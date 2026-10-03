import { getUsersByIds } from '@yayatoh/auth';
import { doorStaffQuery } from '@yayatoh/checkin';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { listMembersQuery, roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DoorStaffForm } from '@/components/door-staff-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { removeDoorStaffAction, saveDoorStaffAction } from './actions.ts';

/**
 * Door staff of one event and where each may scan (M1.9d). Team managers add, edit and remove;
 * anyone who can read the event sees the list read-only.
 */
export default async function DoorStaffPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  const back = (
    <Link href={`/o/${org}/e/${event}/onsite`} className="text-body underline">
      {t('doorStaff.back')}
    </Link>
  );
  if (!roleCan(data.role, 'events:read')) {
    return (
      <>
        <PageHeader title={t('doorStaff.title')} />
        <EmptyState
          title={t('checkin.noAccessTitle')}
          description={t('doorStaff.noAccess')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {t('checkin.backToEvent')}
            </Link>
          }
        />
      </>
    );
  }
  const canManage = roleCan(data.role, 'members:manage');
  const { staff, checkpoints } = await executeQuery(doorStaffQuery, { eventId: ev.id }, data.ctx, ports);
  const cpName = new Map(checkpoints.map((c) => [c.id, c.name]));
  const members = canManage ? await executeQuery(listMembersQuery, {}, data.ctx, ports) : [];
  const people = await getUsersByIds([
    ...new Set([...staff.map((s) => s.userId), ...members.map((m) => m.userId)]),
  ]);
  const nameOf = (id: string) => people.get(id)?.name ?? t('team.unknownUser');
  const assigned = new Set(staff.map((s) => s.userId));
  // Anyone whose org role already scans everywhere doesn't need an event assignment.
  const candidates = members
    .filter((m) => !assigned.has(m.userId) && !roleCan(m.role, 'checkin:scan'))
    .map((m) => ({ id: m.userId, name: nameOf(m.userId) }));
  const save = saveDoorStaffAction.bind(null, org, event);
  return (
    <>
      <PageHeader title={t('doorStaff.title')} description={t('doorStaff.description', { event: ev.name })} />
      {back}
      <section aria-labelledby="staff-list-heading" className="flex flex-col gap-3">
        <h2 id="staff-list-heading" className="text-section">
          {t('doorStaff.listTitle')}
        </h2>
        {staff.length === 0 ? (
          <EmptyState
            title={t('doorStaff.emptyTitle')}
            description={canManage ? t('doorStaff.emptyDescription') : t('doorStaff.emptyReadOnly')}
            action={
              canManage ? (
                <Link href="#staff-add-heading" className={buttonClass('primary', 'md')}>
                  {t('doorStaff.addFirst')}
                </Link>
              ) : (
                <Link href={`/o/${org}/e/${event}/onsite`} className={buttonClass('secondary', 'md')}>
                  {t('doorStaff.openCheckin')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {staff.map((s) => {
              const name = nameOf(s.userId);
              const where =
                s.checkpointIds.length === 0
                  ? t('doorStaff.anywhere')
                  : s.checkpointIds
                      .map((id) => cpName.get(id) ?? t('doorStaff.archivedCheckpoint'))
                      .join(', ');
              return (
                <li key={s.userId}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <h3 className="text-body font-medium">{name}</h3>
                      <p className="text-caption text-ink-2" data-testid="staff-scope">
                        {t('doorStaff.scansAt', { where })}
                      </p>
                    </div>
                    {canManage ? (
                      <>
                        <DoorStaffForm
                          action={save}
                          checkpoints={checkpoints}
                          member={{ id: s.userId, name }}
                          selected={s.checkpointIds}
                        />
                        <form action={removeDoorStaffAction.bind(null, org, event, s.userId)}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t('doorStaff.removeFor', { name })}
                          >
                            {t('doorStaff.remove')}
                          </Button>
                        </form>
                      </>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {canManage ? (
        <section aria-labelledby="staff-add-heading" className="flex flex-col gap-3">
          <h2 id="staff-add-heading" className="text-section">
            {t('doorStaff.addTitle')}
          </h2>
          <p className="text-caption text-ink-2">{t('doorStaff.addHint')}</p>
          <Card>
            <DoorStaffForm action={save} checkpoints={checkpoints} members={candidates} />
          </Card>
        </section>
      ) : (
        <p className="text-caption text-ink-2">{t('doorStaff.readOnly')}</p>
      )}
    </>
  );
}
