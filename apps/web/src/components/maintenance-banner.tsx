import { freezeCovers, readOnlyFreeze } from '@yayatoh/platform';
import { Wrench } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * The read-only freeze (M2.5a, roadmap §7.8): shown on every console page of a frozen org (`orgId`),
 * and on every page while the whole platform is frozen (`orgId` omitted, from the root layout). Says what
 * still works (looking, exports, door scans, public pages) and, when announced, until when. The
 * staff reason is never shown.
 */
export async function MaintenanceBanner({
  orgId,
  locale,
  timeZone,
}: {
  orgId?: string;
  locale: string;
  timeZone?: string;
}) {
  const state = await readOnlyFreeze().catch(() => null);
  if (!state) return null;
  // Platform-wide: the root layout shows it on every page (once). Org-scoped: the console of each
  // frozen org does.
  if (
    orgId === undefined ? state.scope !== 'platform' : state.scope !== 'orgs' || !freezeCovers(state, orgId)
  )
    return null;
  const t = await getTranslations('maintenance');
  const until = state.expectedEndAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        state.expectedEndAt,
      )
    : null;
  return (
    <section
      aria-label={t('label')}
      data-testid="maintenance-banner"
      className="flex items-start gap-3 border-b border-primary bg-primary-soft px-4 py-3 text-primary-ink md:px-8"
    >
      <Wrench aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-medium">{t('title')}</p>
        <p className="text-body">{until ? t('bodyUntil', { until }) : t('body')}</p>
      </div>
    </section>
  );
}
