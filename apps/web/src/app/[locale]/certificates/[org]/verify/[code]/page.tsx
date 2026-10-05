import { formatCredits, normalizeCode, verifyCertificateQuery } from '@yayatoh/ce';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, buttonClass, Card, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { ports } from '@/server/ports.ts';

type Params = { params: Promise<{ locale: string; org: string; code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ce.verify');
  return { title: t('metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

/**
 * The public check of a CE certificate (M6.9b), phone first: anyone holding the certificate (an
 * employer, a licensing board) confirms its code. The org comes from the path. It shows the status,
 * a masked name, the event, the organizer, the credits and the dates; an unknown code says only
 * that nothing was found.
 */
export default async function VerifyPage({ params }: Params) {
  const { locale, org, code: raw } = await params;
  pageLocale(locale);
  if (!z.uuid().safeParse(org).success) notFound();
  const t = await getTranslations('ce.verify');
  const code = normalizeCode(decodeURIComponent(raw));
  const v = code
    ? await executeQuery(verifyCertificateQuery, { code }, createCtx({ orgId: org }), ports).catch((err) => {
        if (isDomainError(err)) return null;
        throw err;
      })
    : null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: v?.timezone ?? 'UTC' });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      {!v ? (
        <Alert tone="warning" title={t('notFound')}>
          {t('notFoundHint')}
        </Alert>
      ) : (
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-body tracking-[0.15em]" dir="ltr">
                {v.code}
              </span>
              {v.status === 'issued' ? (
                <StatusPill tone="success" label={t('valid')} />
              ) : (
                <StatusPill tone="danger" label={t('revoked')} />
              )}
            </div>
            {v.status === 'revoked' ? <Alert tone="warning" title={t('revokedHint')} /> : null}
            <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="text-caption text-ink-2">{t('holder')}</dt>
              <dd className="m-0 font-medium">{v.holder}</dd>
              <dt className="text-caption text-ink-2">{t('event')}</dt>
              <dd className="m-0">{v.eventName}</dd>
              <dt className="text-caption text-ink-2">{t('organizer')}</dt>
              <dd className="m-0">{v.orgName}</dd>
              {v.accreditor ? (
                <>
                  <dt className="text-caption text-ink-2">{t('accreditor')}</dt>
                  <dd className="m-0">{v.accreditor}</dd>
                </>
              ) : null}
              <dt className="text-caption text-ink-2">{t('credits')}</dt>
              <dd className="m-0" data-testid="verify-credits">
                {t('creditsValue', {
                  credits: formatCredits(v.totalCredits, locale),
                  label: v.creditLabel ?? t('defaultLabel'),
                })}
              </dd>
              <dt className="text-caption text-ink-2">{t('issued')}</dt>
              <dd className="m-0">{date.format(v.issuedAt)}</dd>
              {v.revision > 1 ? (
                <>
                  <dt className="text-caption text-ink-2">{t('revised')}</dt>
                  <dd className="m-0">
                    {t('revisedValue', { revision: v.revision, date: date.format(v.revisedAt) })}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        </Card>
      )}
      <Link href={`/certificates/${org}/verify`} className={buttonClass('secondary')}>
        {t('another')}
      </Link>
    </main>
  );
}
