import { guestStatusQuery } from '@yayatoh/assistance';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { buttonClass, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RefreshStatus } from '@/components/assistance-guest.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';

const DOT = {
  new: 'warning',
  assigned: 'info',
  in_progress: 'info',
  resolved: 'success',
  cancelled: 'neutral',
} as const;

/**
 * A guest's help request, from the status link they got when asking (M3.3b): its number, what
 * they asked about and where it stands. No staff names or notes. "Refresh status" re-reads it.
 */
export default async function GuestHelpStatusPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
}) {
  const { locale, slug, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const [ev, target] = await Promise.all([publicEventBySlug(slug), checkoutTarget(slug)]);
  if (!ev || !target) notFound();
  const status = await executeQuery(
    guestStatusQuery,
    { eventId: target.eventId, token: token.slice(0, 200) },
    createCtx({ orgId: target.orgId, locale }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'validation_failed')) return null;
    throw err;
  });
  if (!status) notFound();
  const t = await getTranslations('assistance');
  const when = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: ev.timezone });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('guest.statusTitle', { number: status.number })}
      />
      <Card size="panel" className="flex flex-col gap-3">
        <p className="text-body">{t('guest.askedAbout', { reason: t(`reason.${status.reason}`) })}</p>
        <p role="status" className="flex items-center gap-2 text-section" data-testid="guest-help-state">
          <StatusDot status={DOT[status.state]} label={t(`guest.state.${status.state}`)} />
        </p>
        <p className="text-body text-zinc-700">{t(`guest.stateHint.${status.state}`)}</p>
        <p className="text-caption text-zinc-600">
          {t('guest.lastUpdate', { time: when.format(status.updatedAt) })}
        </p>
      </Card>
      <p className="text-body text-zinc-700">{t('guest.emergencyShort')}</p>
      <div className="flex flex-wrap gap-3">
        <RefreshStatus label={t('guest.refresh')} />
        <Link href={`/events/${slug}/seat-finder`} className={buttonClass('secondary')}>
          {t('guest.back')}
        </Link>
      </div>
    </main>
  );
}
