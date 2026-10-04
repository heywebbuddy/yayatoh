import { clientAgencyOpsQuery } from '@yayatoh/agency-ops';
import { getUsersByIds } from '@yayatoh/auth';
import type { Ctx } from '@yayatoh/kernel';
import { executeQuery } from '@yayatoh/kernel';
import { listAgencyStaffGrantsQuery } from '@yayatoh/tenancy';
import { Button, SectionHeader, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { formatDate } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { applyBrandKitAction, revokeAgencyPersonAction } from './actions.ts';

/**
 * Agency v2 on the client's Agencies page (M6.8b): the agency people with a named team place or a
 * day-of pass (revocable here), brand kits received (applied by the client's own admins), and
 * everything received from agencies, which stays the client's after a detach.
 */
export async function AgencyOpsSections({
  org,
  ctx,
  agencyNames,
  manage,
  canApply,
  locale,
  timeZone,
  currency,
}: {
  org: string;
  ctx: Ctx;
  agencyNames: ReadonlyMap<string, string>;
  manage: boolean;
  canApply: boolean;
  locale: string;
  timeZone: string;
  currency: string;
}) {
  const t = await getTranslations('agencyOps');
  const ta = await getTranslations('agencies');
  const [staff, view] = await Promise.all([
    executeQuery(listAgencyStaffGrantsQuery, {}, ctx, ports),
    executeQuery(clientAgencyOpsQuery, {}, ctx, ports),
  ]);
  const people = await getUsersByIds([...new Set(staff.map((s) => s.userId))]);
  const nameOf = (id: string) => people.get(id)?.name || people.get(id)?.email || t('team.unknownPerson');
  const agencyOf = (id: string | null) => (id ? agencyNames.get(id) : undefined) ?? ta('unknownAgency');
  const f = { locale, currency, timeZone };
  const when = (d: Date | null) =>
    d
      ? formatDate(d.toISOString(), f, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
  const day = (d: Date) =>
    formatDate(d.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <>
      <section aria-labelledby="agency-people" className="flex flex-col gap-3">
        <SectionHeader
          id="agency-people"
          title={t('client.peopleTitle')}
          description={t('client.peopleIntro')}
        />
        <Table
          caption={t('client.peopleTitle')}
          rowKey={(s) => s.id}
          rows={staff}
          empty={t('client.peopleEmpty')}
          columns={[
            { key: 'agency', header: ta('agencyColumn'), cell: (s) => agencyOf(s.agencyOrgId) },
            { key: 'person', header: t('team.person'), cell: (s) => nameOf(s.userId) },
            {
              key: 'access',
              header: t('client.accessColumn'),
              cell: (s) =>
                s.kind === 'team'
                  ? t('client.accessTeam')
                  : t('client.accessDayOf', { start: when(s.startsAt), end: when(s.endsAt) }),
            },
            { key: 'role', header: t('team.role'), cell: (s) => ta('roleLabel', { role: s.role }) },
            ...(manage
              ? [
                  {
                    key: 'actions',
                    header: ta('actions'),
                    align: 'end' as const,
                    cell: (s: (typeof staff)[number]) => (
                      <StepUpForm action={revokeAgencyPersonAction.bind(null, org, s.id)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('team.revokeNamed', { name: nameOf(s.userId) })}
                        >
                          {t('team.revoke')}
                        </Button>
                      </StepUpForm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>
      <section aria-labelledby="agency-kits" className="flex flex-col gap-3">
        <SectionHeader id="agency-kits" title={t('client.kitsTitle')} description={t('client.kitsIntro')} />
        <Table
          caption={t('client.kitsTitle')}
          rowKey={(k) => k.id}
          rows={view.brandKits}
          empty={t('client.kitsEmpty')}
          columns={[
            {
              key: 'name',
              header: t('library.kitName'),
              cell: (k) => <span className="font-semibold">{k.name}</span>,
            },
            {
              key: 'color',
              header: t('library.kitColor'),
              cell: (k) => (
                <span dir="ltr" className="font-mono text-caption">
                  {k.brandColor}
                </span>
              ),
            },
            { key: 'from', header: ta('agencyColumn'), cell: (k) => agencyOf(k.receivedFromAgencyOrgId) },
            {
              key: 'state',
              header: t('client.kitState'),
              cell: (k) =>
                k.appliedAt ? (
                  <StatusPill tone="success" label={t('client.applied')} />
                ) : (
                  <StatusPill tone="neutral" label={t('client.notApplied')} />
                ),
            },
            ...(canApply
              ? [
                  {
                    key: 'actions',
                    header: ta('actions'),
                    align: 'end' as const,
                    cell: (k: (typeof view.brandKits)[number]) => (
                      <StepUpForm action={applyBrandKitAction.bind(null, org, k.id)}>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          aria-label={t('client.applyNamed', { name: k.name })}
                        >
                          {t('client.apply')}
                        </Button>
                      </StepUpForm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>
      <section aria-labelledby="agency-received" className="flex flex-col gap-3">
        <SectionHeader
          id="agency-received"
          title={t('client.receivedTitle')}
          description={t('client.receivedIntro')}
        />
        <Table
          caption={t('client.receivedTitle')}
          rowKey={(i) => `${i.kind}-${i.localId}`}
          rows={view.items}
          empty={t('client.receivedEmpty')}
          columns={[
            { key: 'kind', header: t('client.kindColumn'), cell: (i) => t(`client.kind_${i.kind}`) },
            { key: 'from', header: ta('agencyColumn'), cell: (i) => agencyOf(i.agencyOrgId) },
            { key: 'at', header: t('client.receivedColumn'), mono: true, cell: (i) => day(i.receivedAt) },
            {
              key: 'link',
              header: t('client.linkColumn'),
              cell: (i) =>
                i.attached ? (
                  <StatusPill tone="info" label={t('client.attached')} />
                ) : (
                  <StatusPill tone="neutral" label={t('client.detachedItem')} />
                ),
            },
          ]}
        />
      </section>
    </>
  );
}
