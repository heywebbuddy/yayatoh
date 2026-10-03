import { agencyClientsQuery, agencyEventsQuery } from '@yayatoh/agency';
import { agencyStaffQuery } from '@yayatoh/agency-ops';
import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { listMembersQuery } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, CardHeader, EmptyState, SectionHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgencyV2 } from '../load.ts';
import { addDayOfAction, addTeamAction, handOverAction, revokeStaffAction } from '../ops-actions.ts';
import { DayOfForm, HandoverForm, TeamForm } from '../ops-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.team') };
}

/**
 * Team (M6.8b): per client, who of the agency works for it (once a team is named, only they act
 * through the grant), day-of passes for an event (in force only in their window), and handover.
 */
export default async function AgencyTeamPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead, canManage } = await loadAgencyV2(org);
  if (!canRead) return null;
  const t = await getTranslations('agencyOps');
  const ta = await getTranslations('agencies');
  const [clients, staff, events] = await Promise.all([
    executeQuery(agencyClientsQuery, {}, data.ctx, ports),
    executeQuery(agencyStaffQuery, {}, data.ctx, ports),
    executeQuery(agencyEventsQuery, {}, data.ctx, ports),
  ]);
  if (clients.length === 0)
    return (
      <EmptyState
        title={t('team.noClientsTitle')}
        description={t('team.noClientsDescription')}
        action={
          <Link href={`/o/${org}/agency`} className={buttonClass('primary', 'md')}>
            {t('actions.openClients')}
          </Link>
        }
      />
    );
  const members = canManage ? await executeQuery(listMembersQuery, {}, data.ctx, ports) : [];
  const people = await getUsersByIds([
    ...new Set([...members.map((m) => m.userId), ...staff.map((s) => s.userId)]),
  ]);
  const nameOf = (id: string) => people.get(id)?.name || people.get(id)?.email || t('team.unknownPerson');
  const everyone = members.map((m) => ({ id: m.userId, name: nameOf(m.userId) }));
  const standing = members
    .filter((m) => m.role !== 'collaborator')
    .map((m) => ({ id: m.userId, name: nameOf(m.userId) }));
  const now = new Date();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-2">{t('team.intro')}</p>
      {clients.map((c) => {
        const f = { locale, currency: c.currency, timeZone: c.timezone };
        const when = (d: Date | null) =>
          d
            ? formatDate(d.toISOString(), f, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';
        const rows = staff.filter((s) => s.clientOrgId === c.clientOrgId);
        const team = rows.filter((s) => s.kind === 'team');
        const passes = rows.filter((s) => s.kind === 'day_of');
        const clientEvents = events
          .filter((e) => e.clientOrgId === c.clientOrgId && e.endsAt > now && e.status !== 'cancelled')
          .map((e) => ({ id: e.eventId, label: `${e.name} · ${when(e.startsAt)}` }));
        const revoke = (s: (typeof rows)[number]) => (
          <StepUpForm action={revokeStaffAction.bind(null, org, c.clientOrgId, s.id)}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              aria-label={t('team.revokeNamed', { name: nameOf(s.userId) })}
            >
              {t('team.revoke')}
            </Button>
          </StepUpForm>
        );
        const id = `client-${c.clientOrgId}`;
        return (
          <Card key={c.clientOrgId} className="flex flex-col gap-5">
            <CardHeader title={c.name} meta={ta('roleLabel', { role: c.role })} id={id} />
            <section aria-labelledby={`${id}-team`} className="flex flex-col gap-3">
              <SectionHeader id={`${id}-team`} title={t('team.teamTitle')} as="h3" />
              <Table
                caption={t('team.teamCaption', { client: c.name })}
                rowKey={(s) => s.id}
                rows={team}
                empty={t('team.teamEmpty')}
                columns={[
                  { key: 'person', header: t('team.person'), cell: (s) => nameOf(s.userId) },
                  { key: 'role', header: t('team.role'), cell: (s) => ta('roleLabel', { role: s.role }) },
                  ...(canManage
                    ? [{ key: 'actions', header: t('team.actions'), align: 'end' as const, cell: revoke }]
                    : []),
                ]}
              />
              {canManage ? (
                <TeamForm
                  action={addTeamAction.bind(null, org, c.clientOrgId)}
                  people={standing}
                  idPrefix={`${id}-team`}
                />
              ) : null}
            </section>
            <section aria-labelledby={`${id}-dayof`} className="flex flex-col gap-3">
              <SectionHeader id={`${id}-dayof`} title={t('team.dayOfTitle')} as="h3" />
              <Table
                caption={t('team.dayOfCaption', { client: c.name })}
                rowKey={(s) => s.id}
                rows={passes}
                empty={t('team.dayOfEmpty')}
                columns={[
                  { key: 'person', header: t('team.person'), cell: (s) => nameOf(s.userId) },
                  { key: 'role', header: t('team.role'), cell: (s) => ta('roleLabel', { role: s.role }) },
                  {
                    key: 'window',
                    header: t('team.window'),
                    mono: true,
                    cell: (s) => t('team.windowValue', { start: when(s.startsAt), end: when(s.endsAt) }),
                  },
                  ...(canManage
                    ? [{ key: 'actions', header: t('team.actions'), align: 'end' as const, cell: revoke }]
                    : []),
                ]}
              />
              {canManage ? (
                <DayOfForm
                  action={addDayOfAction.bind(null, org, c.clientOrgId)}
                  people={everyone}
                  events={clientEvents}
                  idPrefix={id}
                />
              ) : null}
            </section>
            {canManage ? (
              <section aria-labelledby={`${id}-handover`} className="flex flex-col gap-2">
                <SectionHeader
                  id={`${id}-handover`}
                  title={t('team.handoverTitle')}
                  description={t('team.handoverDescription', { client: c.name })}
                  as="h3"
                />
                <HandoverForm
                  action={handOverAction.bind(null, org, c.clientOrgId)}
                  label={t('team.handoverNamed', { client: c.name })}
                >
                  {t('team.handover')}
                </HandoverForm>
              </section>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
