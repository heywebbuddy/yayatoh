import { exemptProblem } from '@yayatoh/donations';
import { Alert, Button, buttonClass, Card, cx, PageHeader, StatusDot, StatusPill } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { Shell } from '@/components/shell.tsx';
import { charityOfOrg, irsList } from '@/server/charities.ts';
import { requireStaff } from '@/server/staff.ts';
import { rejectCharityAction, verifyCharityAction } from './actions.ts';

const field = 'field w-full';
const label = 'text-[13px] font-bold text-ink';
const term = 'text-caption font-bold text-ink-2';
const value = 'm-0 text-body text-ink';
const tone = { pending: 'waiting', verified: 'success', rejected: 'danger' } as const;

export async function generateMetadata() {
  const t = await getTranslations('charities');
  return { title: t('reviewTitle') };
}

const normalize = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Review one org's charity profile (M4.8b): what the org entered beside what the IRS
 * exempt-organization list says about the EIN (the fiscal sponsor's for a sponsored project),
 * whether that makes it eligible, and the verdict: verify (optional note) or reject (note the org
 * sees). Every verdict is an audited platform command in the org.
 */
export default async function CharityReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('charities');
  const { orgId } = await params;
  const { done, error } = await searchParams;
  if (!z.uuid().safeParse(orgId).success) notFound();
  const t = await getTranslations('charities');
  const profile = await charityOfOrg(staff, orgId);
  if (!profile) notFound();
  const irs = irsList();
  const checkedEin = profile.sponsorEin ?? profile.ein;
  const record = irs ? await irs.lookup(checkedEin) : null;
  const problem = irs ? exemptProblem(record) : 'unavailable';
  const checkedName = profile.sponsorName ?? profile.legalName;
  const nameMatches = record ? normalize(record.name) === normalize(checkedName) : false;
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <Link href="/charities" className={buttonClass('ghost', 'sm', 'self-start')}>
        <ArrowLeft aria-hidden="true" strokeWidth={2} className="rtl:-scale-x-100" />
        {t('back')}
      </Link>
      <PageHeader title={t('reviewHeading', { org: profile.orgName })} description={t('reviewDescription')} />
      {done ? (
        <Alert
          tone={done === 'verified' ? 'success' : 'info'}
          title={t(`done.${done === 'verified' ? 'verified' : 'rejected'}`)}
        />
      ) : null}
      {error ? (
        <Alert title={t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.internal')} />
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-labelledby="profile-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="profile-heading" className="m-0 text-card text-ink">
            {t('profileTitle')}
          </h2>
          <Card size="panel" className="flex flex-col gap-4">
            <StatusPill
              tone={tone[profile.status]}
              label={t(`statuses.${profile.status}`)}
              className="self-start"
            />
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
              <dt className={term}>{t('legalName')}</dt>
              <dd className={value}>{profile.legalName}</dd>
              <dt className={term}>{t('ein')}</dt>
              <dd className={cx(value, 'font-mono')}>{profile.ein}</dd>
              <dt className={term}>{t('kind')}</dt>
              <dd className={value}>{t(`kinds.${profile.exemptKind}`)}</dd>
              {profile.sponsorName ? (
                <>
                  <dt className={term}>{t('sponsor')}</dt>
                  <dd className={value}>
                    {profile.sponsorName} · <span className="font-mono">{profile.sponsorEin}</span>
                  </dd>
                </>
              ) : null}
              {profile.address ? (
                <>
                  <dt className={term}>{t('address')}</dt>
                  <dd className={value}>{profile.address}</dd>
                </>
              ) : null}
              <dt className={term}>{t('submitted')}</dt>
              <dd className={cx(value, 'tabular-nums')}>
                {when.format(profile.submittedAt)} UTC · {t('version', { version: profile.version })}
              </dd>
              {profile.reviewNote ? (
                <>
                  <dt className={term}>{t('note')}</dt>
                  <dd className={value}>{profile.reviewNote}</dd>
                </>
              ) : null}
            </dl>
          </Card>
        </section>

        <section aria-labelledby="irs-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="irs-heading" className="m-0 text-card text-ink">
            {t('irsTitle', { ein: checkedEin })}
          </h2>
          <Card size="panel" className="flex flex-col gap-4">
            {!irs ? (
              <Alert tone="warning" title={t('irsUnavailable')} />
            ) : (
              <>
                <p className="m-0 text-caption text-ink-2">{t(`source.${irs.source}`)}</p>
                {record ? (
                  <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
                    <dt className={term}>{t('irsName')}</dt>
                    <dd className={value}>
                      {record.name}{' '}
                      <span
                        className={cx(
                          'text-caption font-bold',
                          nameMatches ? 'text-success' : 'text-warning',
                        )}
                      >
                        ({nameMatches ? t('nameMatches') : t('nameDiffers')})
                      </span>
                    </dd>
                    <dt className={term}>{t('irsPlace')}</dt>
                    <dd className={value}>{[record.city, record.state].filter(Boolean).join(', ')}</dd>
                    <dt className={term}>{t('irsSubsection')}</dt>
                    <dd className={cx(value, 'font-mono')}>{record.subsection}</dd>
                    <dt className={term}>{t('irsDeductibility')}</dt>
                    <dd className={cx(value, 'font-mono')}>{record.deductibility}</dd>
                    <dt className={term}>{t('irsStatus')}</dt>
                    <dd className={cx(value, 'font-mono')}>{record.status}</dd>
                  </dl>
                ) : null}
                <div className="rounded-tile border border-line bg-surface-2 px-4 py-3">
                  <StatusDot
                    status={problem ? 'danger' : 'success'}
                    label={problem ? t(`problems.${problem}`) : t('eligible')}
                  />
                </div>
              </>
            )}
          </Card>
        </section>
      </div>

      {staff.can('charities') ? (
        <section aria-labelledby="verdict-heading" className="flex flex-col gap-3">
          <h2 id="verdict-heading" className="m-0 text-card text-ink">
            {t('verdictTitle')}
          </h2>
          <Card size="panel" className="flex flex-col gap-5">
            {!problem && profile.status !== 'verified' ? (
              <form
                action={verifyCharityAction.bind(null, orgId, profile.version)}
                aria-label={t('verifyForm')}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                  <label htmlFor="verify-note" className={label}>
                    {t('verifyNote')}
                  </label>
                  <input id="verify-note" name="note" maxLength={500} className={field} />
                </div>
                <Button type="submit">{t('verify')}</Button>
              </form>
            ) : (
              <p className="m-0 text-body text-ink-2">
                {profile.status === 'verified' ? t('alreadyVerified') : t('cannotVerify')}
              </p>
            )}
            <form
              action={rejectCharityAction.bind(null, orgId, profile.version)}
              aria-label={t('rejectForm')}
              className="flex flex-wrap items-end gap-3 border-t border-line pt-5"
            >
              <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                <label htmlFor="reject-note" className={label}>
                  {t('rejectNote')}
                </label>
                <input
                  id="reject-note"
                  name="note"
                  required
                  minLength={3}
                  maxLength={500}
                  className={field}
                />
              </div>
              <Button type="submit" variant="danger">
                {profile.status === 'verified' ? t('withdraw') : t('reject')}
              </Button>
            </form>
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
