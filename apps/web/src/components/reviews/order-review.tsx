import { reviewStateForOrder } from '@yayatoh/reviews';
import { Card } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { submitReviewAction } from '@/app/[locale]/orders/[token]/actions.ts';
import { ReviewForm } from './review-form.tsx';
import { Stars } from './stars.tsx';

/**
 * The review panel of a buyer's order page (M1.4g): the form once their ticket's date has
 * ended, their review once written, or when reviews open. Dates in the event's timezone.
 */
export async function OrderReview({
  orgId,
  token,
  locale,
  timeZone,
}: {
  orgId: string;
  token: string;
  locale: string;
  timeZone: string;
}) {
  const state = await reviewStateForOrder(orgId, token);
  if (!state) return null;
  const { eligibility: e, review } = state;
  if (!review && !e.ok && e.reason === 'no_ticket') return null;
  const t = await getTranslations('reviews.order');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone });
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-3">
      <h2 id="review-heading" className="text-section">
        {t('title')}
      </h2>
      {review ? (
        <Card className="flex flex-col gap-2">
          <p className="text-caption text-zinc-600">{t('yours')}</p>
          <Stars rating={review.rating} label={t('ratingLabel', { rating: review.rating })} />
          {review.body ? <p className="whitespace-pre-line text-body">{review.body}</p> : null}
          {review.status === 'hidden' ? <p className="text-caption text-zinc-600">{t('hidden')}</p> : null}
        </Card>
      ) : e.ok ? (
        <Card className="flex flex-col gap-3">
          <p className="text-body text-zinc-600">{t('invite', { until: when.format(e.closesAt) })}</p>
          <ReviewForm action={submitReviewAction.bind(null, token)} />
        </Card>
      ) : e.reason === 'not_ended' && e.opensAt ? (
        <p className="text-body text-zinc-600">{t('opensAt', { date: when.format(e.opensAt) })}</p>
      ) : e.reason === 'window_closed' && e.closesAt ? (
        <p className="text-body text-zinc-600">{t('closed', { date: when.format(e.closesAt) })}</p>
      ) : (
        <p className="text-body text-zinc-600">{t('notHeld')}</p>
      )}
    </section>
  );
}
