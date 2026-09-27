import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { claimContext, claimDetailsQuery } from '@yayatoh/ticketing';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClaimForm } from '@/components/claim-form.tsx';
import { formatEventDateRange } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { claimAction } from './actions.ts';

/** A claim link: whoever opens it can take the ticket in their own name. */
export default async function ClaimPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const c = await claimContext(decodeURIComponent(token));
  if (!c) notFound();
  const details = await executeQuery(claimDetailsQuery, { claimId: c.id }, c.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations();
  const when = formatEventDateRange(
    details.event.startsAt.toISOString(),
    details.event.endsAt.toISOString(),
    {
      locale,
      currency: 'USD',
      timeZone: details.event.timezone,
    },
  );
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('claim.eyebrow')}</Label>}
        title={details.event.name}
        description={`${details.ticketTypeName} · ${when}`}
      />
      {details.state === 'open' ? (
        <Card size="panel" className="flex flex-col gap-4">
          <p className="text-body">{t('claim.intro')}</p>
          <ClaimForm action={claimAction.bind(null, decodeURIComponent(token))} />
        </Card>
      ) : (
        <EmptyState title={t(`claim.state.${details.state}`)} description={t('claim.stateHint')} />
      )}
    </main>
  );
}
