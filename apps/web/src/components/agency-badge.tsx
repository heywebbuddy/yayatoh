import { Badge, buttonClass, cx } from '@yayatoh/ui';
import { Briefcase } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import type { ConsoleData } from '@/server/console.ts';

/**
 * M6.7a: the "via Agency" badge on every page of a client org that a user reaches through an
 * agency grant (org and event pages share the console shell), with the way back to the agency.
 */
export async function AgencyBadge({ data }: { data: NonNullable<ConsoleData> }) {
  if (!data.agency) return null;
  const t = await getTranslations('shell');
  const agency = data.agency.name;
  return (
    <section
      aria-label={t('agencyBadgeLabel', { org: data.org.name, agency })}
      data-testid="via-agency"
      className="flex flex-wrap items-center gap-3 rounded-tile border border-line bg-surface px-4 py-2.5"
    >
      <Briefcase aria-hidden="true" className="size-4 shrink-0 text-ink-2" strokeWidth={2} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-body">
        <span className="font-semibold">{data.org.name}</span>
        <Badge tone="brand">{t('viaAgency', { agency })}</Badge>
      </span>
      <Link href={`/o/${data.agency.slug}/agency`} className={cx(buttonClass('ghost', 'sm'))}>
        {t('backToAgency', { agency })}
      </Link>
    </section>
  );
}
