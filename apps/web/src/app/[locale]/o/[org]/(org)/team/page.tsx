import { executeQuery } from '@yayatoh/kernel';
import { listMembersQuery } from '@yayatoh/tenancy';
import { Avatar, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { personaById } from '@/server/personas.ts';
import { ports } from '@/server/ports.ts';

export default async function TeamPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const members = await executeQuery(listMembersQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const rows = members.map((m) => {
    const p = personaById(m.userId);
    return { ...m, name: p?.name ?? t('team.unknownUser'), initials: p?.initials ?? '··' };
  });
  return (
    <>
      <PageHeader title={t('nav.team')} description={t('team.subtitle', { count: rows.length })} />
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
        ]}
      />
    </>
  );
}
