import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { disputesQuery } from '@yayatoh/payments';
import { disputeEvidenceQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { EvidencePreview } from '@/components/evidence-preview.tsx';
import { EvidenceReviewForm } from '@/components/evidence-review-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { evidencePacketDocument } from '@/server/evidence.ts';
import { ports } from '@/server/ports.ts';
import { evidenceAction } from './actions.ts';

/**
 * Respond to a dispute (M1.6e): the evidence packet built from the order, its tickets, the door's
 * scan log and the messages sent, previewed exactly as it will be sent; the organizer writes a
 * statement, leaves optional sections out, confirms they read it and submits. Owners, admins and
 * finance.
 */
export default async function DisputeReviewPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; orderId: string; disputeId: string }>;
}) {
  const { locale, org, event, orderId, disputeId } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(disputeId).success || !z.uuid().safeParse(orderId).success) notFound();
  const { data, event: ev } = await loadEvent(org, event, 'ticketsOrders');
  if (!roleCan(data.role, 'disputes:respond')) notFound();
  const t = await getTranslations('disputes');
  let evidence: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(disputeEvidenceQuery, { disputeId }, data.ctx, ports);
  try {
    evidence = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  if (evidence.order.id !== orderId) notFound();
  const [dispute] = (await executeQuery(disputesQuery, { orderId }, data.ctx, ports)).filter(
    (d) => d.id === disputeId,
  );
  if (!dispute) notFound();
  const doc = await evidencePacketDocument(evidence);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const orderPath = `/o/${org}/e/${event}/orders/${orderId}`;
  return (
    <>
      <PageHeader title={t('review.title')} description={t('review.description')} />
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatusDot
          status={dispute.status === 'won' ? 'success' : dispute.status === 'lost' ? 'danger' : 'warning'}
          label={t(`status.${dispute.status}`)}
        />
        <span className="font-mono tabular-nums">
          {formatMoney(money(dispute.amountMinor, dispute.currency), locale)}
        </span>
        <span className="text-caption text-ink-2">{dispute.reason}</span>
        {dispute.evidenceDueBy ? (
          <span className="text-caption text-ink-2">
            {t('dueBy', { date: when.format(dispute.evidenceDueBy) })}
          </span>
        ) : null}
        <Link href={orderPath} className="text-caption underline underline-offset-2">
          {t('review.backToOrder')}
        </Link>
      </Card>
      {dispute.status === 'open' ? (
        <section aria-labelledby="respond-heading" className="flex flex-col gap-3">
          <h2 id="respond-heading" className="text-section">
            {t('review.respondTitle')}
          </h2>
          <Card>
            <EvidenceReviewForm
              action={evidenceAction.bind(null, org, event, orderId, disputeId)}
              summary={dispute.evidenceSummary ?? ''}
              excluded={dispute.evidenceExcluded}
            />
          </Card>
        </section>
      ) : dispute.evidenceSubmittedAt ? (
        <Alert
          tone="info"
          title={t('review.submittedOn', { date: when.format(dispute.evidenceSubmittedAt) })}
        />
      ) : null}
      <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
        <h2 id="preview-heading" className="text-section">
          {t('review.previewTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('review.previewHint')}</p>
        <a
          href={`${orderPath}/disputes/${disputeId}/evidence`}
          className="self-start text-caption underline underline-offset-2"
        >
          {t('evidence')}
        </a>
        <EvidencePreview doc={doc} label={t('review.previewTitle')} />
      </section>
    </>
  );
}
