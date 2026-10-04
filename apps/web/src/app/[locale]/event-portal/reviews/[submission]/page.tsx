import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { cfpReviewerSubmissionQuery } from '@yayatoh/program';
import { Alert, Card } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PortalSignedOut } from '@/components/portal-shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadReviewerPortal } from '@/server/cfp-portal.ts';
import { ports } from '@/server/ports.ts';
import { submitReviewAction } from '../../review-actions.ts';
import { ReviewerShell } from '../../reviewer-portal.tsx';
import { ReviewForm } from './review-form.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cfpReview' });
  return { title: t('reviewTitle'), robots: { index: false, follow: false } };
}

/**
 * One proposal assigned to the signed-in reviewer (M5.3b). Anything not assigned to them — another
 * reviewer's, another event's, a guess — is a 404. Under blind review the people are not shown.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; submission: string }>;
}) {
  const { locale, submission } = await params;
  setRequestLocale(locale);
  const portal = await loadReviewerPortal();
  if (!portal) return <PortalSignedOut />;
  if (!UUID.test(submission)) notFound();
  const s = await executeQuery(
    cfpReviewerSubmissionQuery,
    { submissionId: submission },
    portal.ctx,
    ports,
  ).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations('cfpReview');
  return (
    <ReviewerShell data={portal.data} title={s.title}>
      <Link
        href="/event-portal"
        className="inline-flex min-h-11 items-center self-start text-body underline underline-offset-2"
      >
        {t('back')}
      </Link>
      {s.blind ? <Alert tone="info" title={t('blindNotice')} /> : null}
      <Card className="flex flex-col gap-3">
        <p className="m-0 text-caption text-ink-2">
          {t('minutes', { count: s.durationMinutes })}
          {s.track ? ` · ${s.track}` : ''}
        </p>
        <h2 className="m-0 text-section">{t('abstractHeading')}</h2>
        <p className="m-0 whitespace-pre-line text-body text-ink">{s.abstract}</p>
        {s.answers.length ? (
          <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-[auto_1fr]">
            {s.answers.map((a) => (
              <div key={a.label} className="contents">
                <dt className="font-bold text-ink">{a.label}</dt>
                <dd className="m-0 text-ink-2">{a.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>
      {s.speakerName ? (
        <Card className="flex flex-col gap-2">
          <h2 className="m-0 text-section">{t('speakersHeading')}</h2>
          <p className="m-0 text-body font-bold text-ink">
            {s.speakerName}
            <span className="font-normal text-ink-2">
              {[s.speakerTitle, s.speakerCompany].filter(Boolean).length
                ? ` · ${[s.speakerTitle, s.speakerCompany].filter(Boolean).join(', ')}`
                : ''}
            </span>
          </p>
          {s.speakerBio ? (
            <p className="m-0 whitespace-pre-line text-body text-ink-2">{s.speakerBio}</p>
          ) : null}
          {s.coSpeakers.length ? (
            <p className="m-0 text-body text-ink-2">
              {t('coSpeakers', { names: s.coSpeakers.map((c) => c.name).join(', ') })}
            </p>
          ) : null}
        </Card>
      ) : null}
      <section aria-labelledby="review-heading">
        <Card size="panel" className="flex flex-col gap-3">
          <h2 id="review-heading" className="m-0 text-section">
            {t('yourReview')}
          </h2>
          {s.decided ? (
            <p className="m-0 text-body text-ink-2">
              {s.myReview ? t('decidedWithScore', { score: s.myReview.score }) : t('decided')}
            </p>
          ) : (
            <ReviewForm
              action={submitReviewAction.bind(null, s.id)}
              score={s.myReview?.score ?? null}
              comment={s.myReview?.comment ?? ''}
            />
          )}
        </Card>
      </section>
    </ReviewerShell>
  );
}
