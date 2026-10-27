import { pickupPointsQuery } from '@yayatoh/events';
import { listResponsesQuery } from '@yayatoh/forms';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { Card } from '@yayatoh/ui';
import { MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PICKUP_QUESTION_KEY } from '@/server/pickups.ts';
import { ports } from '@/server/ports.ts';

/**
 * A tour order's pickup point: the one the buyer chose at checkout (their answer to the pickup
 * question), with its address and how early to be there. Shown on the order page for the holder;
 * renders nothing for orders without a choice. The order and its event come from the verified
 * manage link, never from the request.
 */
export async function PickupInfo({
  orgId,
  eventId,
  orderId,
}: {
  orgId: string;
  eventId: string;
  orderId: string;
}) {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'tour.pickup-info' } });
  const subject = { kind: 'checkout_questions', subjectType: 'event', subjectId: eventId } as const;
  const [points, answers] = await Promise.all([
    executeQuery(pickupPointsQuery, { eventId }, ctx, ports),
    executeQuery(listResponsesQuery, { ...subject, respondentIds: [orderId] }, ctx, ports),
  ]);
  const chosen = answers.responses[0]?.answers[PICKUP_QUESTION_KEY];
  const point = points.find((p) => p.id === chosen);
  if (!point) return null;
  const t = await getTranslations('tourPickups');
  return (
    <section aria-labelledby="pickup-info-heading" className="flex flex-col gap-3">
      <h2 id="pickup-info-heading" className="text-section">
        {t('yourPickup')}
      </h2>
      <Card className="flex items-start gap-3">
        <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-ink" />
        <div className="flex flex-col gap-0.5">
          <p className="m-0 text-[17px] font-extrabold">{point.name}</p>
          {point.address ? <p className="m-0 text-body text-ink-2">{point.address}</p> : null}
          <p className="m-0 text-body">
            {point.minutesBefore > 0
              ? t('beforeDeparture', { minutes: point.minutesBefore })
              : t('atDeparture')}
          </p>
        </div>
      </Card>
    </section>
  );
}
