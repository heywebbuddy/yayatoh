import { agencyClientsQuery } from '@yayatoh/agency';
import { agencyFanoutsQuery, fanoutTotals } from '@yayatoh/agency-ops';
import { executeQuery } from '@yayatoh/kernel';
import { Card, SectionHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatDate } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgencyV2 } from '../load.ts';
import { fanOutAction } from '../ops-actions.ts';
import { FanoutForm } from '../ops-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.campaigns') };
}

/**
 * Campaigns (M6.8b): one message fanned out as each client's own campaign. Each client's send
 * uses its own audience, postal address and consent rules; the agency sees outcomes, never people.
 */
export default async function AgencyCampaignsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead, canFanOut } = await loadAgencyV2(org);
  if (!canRead) return null;
  const t = await getTranslations('agencyOps');
  const [fanouts, clients] = await Promise.all([
    executeQuery(agencyFanoutsQuery, {}, data.ctx, ports),
    executeQuery(agencyClientsQuery, {}, data.ctx, ports),
  ]);
  const options = clients.map((c) => ({ id: c.clientOrgId, name: c.name, role: c.role }));
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-2">{t('campaigns.intro')}</p>
      {canFanOut ? (
        <Card>
          <FanoutForm action={fanOutAction.bind(null, org)} clients={options} />
        </Card>
      ) : null}
      <section aria-labelledby="fanout-history" className="flex flex-col gap-3">
        <SectionHeader id="fanout-history" title={t('campaigns.historyTitle')} />
        <Table
          caption={t('campaigns.historyTitle')}
          rowKey={(x) => x.id}
          rows={fanouts}
          empty={t('campaigns.historyEmpty')}
          columns={[
            {
              key: 'name',
              header: t('campaigns.name'),
              cell: (x) => <span className="font-semibold">{x.name}</span>,
            },
            {
              key: 'created',
              header: t('campaigns.created'),
              mono: true,
              cell: (x) =>
                formatDate(x.createdAt.toISOString(), f, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
            },
            { key: 'mode', header: t('campaigns.mode'), cell: (x) => t(`campaigns.modeShort_${x.mode}`) },
            {
              key: 'outcomes',
              header: t('campaigns.outcomes'),
              cell: (x) => {
                const n = fanoutTotals(x.targets);
                return (
                  <span className="flex flex-col">
                    {(['sent', 'draft', 'needs_address', 'failed', 'detached'] as const)
                      .filter((s) => n[s] > 0)
                      .map((s) => (
                        <span key={s}>
                          {t('campaigns.outcomeCount', { outcome: t(`outcome.${s}`), count: n[s] })}
                        </span>
                      ))}
                  </span>
                );
              },
            },
          ]}
        />
      </section>
    </div>
  );
}
