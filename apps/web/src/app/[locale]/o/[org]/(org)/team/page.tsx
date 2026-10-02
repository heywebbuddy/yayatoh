import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { listInvitationsQuery, listMembersQuery, roleCan } from '@yayatoh/tenancy';
import { Avatar, Button, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InviteForm } from '@/components/invite-form.tsx';
import { MemberControls, TeamNotices } from '@/components/member-controls.tsx';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { initialsOf } from '@/server/personas.ts';
import { ports } from '@/server/ports.ts';
import { changeRoleAction, inviteAction, removeMemberAction, revokeAction } from './actions.ts';

export default async function TeamPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const members = await executeQuery(listMembersQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const people = await getUsersByIds(members.map((m) => m.userId));
  const rows = members.map((m) => {
    const name = people.get(m.userId)?.name ?? t('team.unknownUser');
    return { ...m, name, initials: initialsOf(name) };
  });
  const canManage = roleCan(data.role, 'members:manage');
  const canOwn = data.role === 'owner';
  const invitations = canManage ? await executeQuery(listInvitationsQuery, {}, data.ctx, ports) : [];
  return (
    <>
      <PageHeader title={t('nav.team')} description={t('team.subtitle', { count: rows.length })} />
      {canManage ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('team.inviteTitle')}</h2>
          <InviteForm action={inviteAction.bind(null, org)} />
        </Card>
      ) : null}
      <TeamNotices>
        <Table
          caption={t('nav.team')}
          rowKey={(r) => r.userId}
          rows={rows}
          empty={t('team.empty')}
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
            { key: 'role', header: t('team.role'), cell: (r) => t(`roles.${r.role}`) },
            {
              key: 'since',
              header: t('team.since'),
              cell: (r) =>
                formatDate(r.createdAt.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
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
                        canOwn={canOwn}
                        changeRole={changeRoleAction.bind(null, org, r.userId)}
                        remove={removeMemberAction.bind(null, org, r.userId)}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </TeamNotices>
      {invitations.length > 0 ? (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
          <h2 id="pending-heading" className="text-section">
            {t('team.pending')}
          </h2>
          <ul className="flex list-none flex-col divide-y divide-line rounded-card border border-line bg-surface p-0">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-caption text-ink-2">{t(`roles.${i.role}`)}</span>
                <StatusDot
                  status="warning"
                  label={t('team.expires', { date: formatDate(i.expiresAt.toISOString(), f) })}
                />
                <form action={revokeAction.bind(null, org, i.id)}>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('team.revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
