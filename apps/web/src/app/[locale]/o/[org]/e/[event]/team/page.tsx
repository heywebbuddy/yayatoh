import { getUsersByIds } from '@yayatoh/auth';
import { eventTeamQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { TEAM_EVENT_ROLES } from '@yayatoh/tenancy';
import { Avatar, Button, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InviteForm } from '@/components/invite-form.tsx';
import { MemberControls, TeamNotices } from '@/components/member-controls.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { formatDate } from '@/lib/format.ts';
import { profileT } from '@/lib/profile-copy.ts';
import { loadEvent } from '@/server/console.ts';
import { initialsOf } from '@/server/personas.ts';
import { ports } from '@/server/ports.ts';
import {
  changeTeamRoleAction,
  inviteTeamAction,
  removeTeamMemberAction,
  revokeTeamInvitationAction,
} from './actions.ts';

/**
 * M4.2a (P4-8): the event's team. Co-hosts (the couple, the gala chair) get the whole event;
 * planners get guests, RSVP, seating, website, gallery, messages and day-of. Owners, admins and
 * co-hosts invite, change and remove them; members who can see the team see it read-only.
 */
export default async function EventTeamPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can, profile } = await loadEvent(org, event, 'team');
  if (!can('event_team:read')) notFound();
  const t = await getTranslations();
  const tp = profileT(t, profile);
  const canManage = can('event_team:manage');
  const team = await executeQuery(eventTeamQuery, { eventId: ev.id }, data.ctx, ports);
  const people = await getUsersByIds(team.members.map((m) => m.userId));
  const rows = team.members.map((m) => {
    const name = people.get(m.userId)?.name ?? t('team.unknownUser');
    return { ...m, name, initials: initialsOf(name) };
  });
  const f = { locale, currency: ev.currency, timeZone: ev.timezone };
  return (
    <>
      <PageHeader title={t('eventTeam.title')} description={t('eventTeam.subtitle')} />
      <Card className="flex flex-col gap-2">
        <h2 className="text-section">{t('eventTeam.rolesTitle')}</h2>
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {TEAM_EVENT_ROLES.map((r) => (
            <div key={r} className="flex flex-col gap-0.5">
              <dt className="text-body font-medium">{t(`eventRoles.${r}`)}</dt>
              <dd className="text-caption text-zinc-600">{tp(`eventTeam.explain.${r}`)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {canManage ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('eventTeam.inviteTitle')}</h2>
          <InviteForm
            action={inviteTeamAction.bind(null, org, event)}
            roles={TEAM_EVENT_ROLES}
            defaultRole="planner"
            labels="eventRoles"
          />
        </Card>
      ) : null}
      <TeamNotices>
        {rows.length === 0 ? (
          <EmptyState title={t('eventTeam.emptyTitle')} description={t('eventTeam.emptyDescription')} />
        ) : (
          <Table
            caption={t('eventTeam.title')}
            rowKey={(r) => r.userId}
            rows={rows}
            empty={t('eventTeam.emptyTitle')}
            columns={[
              {
                key: 'name',
                header: t('team.name'),
                cell: (r) => (
                  <span className="flex items-center gap-2.5">
                    <Avatar initials={r.initials} label={r.name} size={28} />
                    {r.name}
                  </span>
                ),
              },
              { key: 'role', header: t('team.role'), cell: (r) => t(`eventRoles.${r.role}`) },
              {
                key: 'since',
                header: t('team.since'),
                cell: (r) =>
                  formatDate(r.since.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
                mono: true,
                align: 'end',
              },
              ...(canManage
                ? [
                    {
                      key: 'manage',
                      header: t('team.manage'),
                      cell: (r: (typeof rows)[number]) => (
                        <MemberControls
                          name={r.name}
                          role={r.role}
                          canOwn={false}
                          roles={TEAM_EVENT_ROLES}
                          labels="eventRoles"
                          changeRole={changeTeamRoleAction.bind(null, org, event, r.userId)}
                          remove={removeTeamMemberAction.bind(null, org, event, r.userId)}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </TeamNotices>
      {canManage && team.invitations.length > 0 ? (
        <section aria-labelledby="event-pending-heading" className="flex flex-col gap-3">
          <h2 id="event-pending-heading" className="text-section">
            {t('team.pending')}
          </h2>
          <ul className="flex list-none flex-col divide-y divide-zinc-100 rounded-card border border-zinc-200 bg-white p-0">
            {team.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-caption text-zinc-600">{t(`eventRoles.${i.role}`)}</span>
                <StatusDot
                  status="warning"
                  label={t('team.expires', { date: formatDate(i.expiresAt.toISOString(), f) })}
                />
                <StepUpForm action={revokeTeamInvitationAction.bind(null, org, event, i.id)}>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    aria-label={t('eventTeam.revokeFor', { email: i.email })}
                  >
                    {t('team.revoke')}
                  </Button>
                </StepUpForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
