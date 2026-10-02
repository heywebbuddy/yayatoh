import { exemptProblem } from '@yayatoh/donations';
import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { Shell } from '@/components/shell.tsx';
import { charityOfOrg, irsList } from '@/server/charities.ts';
import { requireStaff } from '@/server/staff.ts';
import { rejectCharityAction, verifyCharityAction } from './actions.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

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
      <p>
        <Link href="/charities" className="text-body underline underline-offset-2">
          {t('back')}
        </Link>
      </p>
      <PageHeader title={t('reviewHeading', { org: profile.orgName })} description={t('reviewDescription')} />
      {done ? <Alert tone="info" title={t(`done.${done === 'verified' ? 'verified' : 'rejected'}`)} /> : null}
      {error ? (
        <Alert title={t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.internal')} />
      ) : null}

      <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
        <h2 id="profile-heading" className="text-section">
          {t('profileTitle')}
        </h2>
        <Card className="flex flex-col gap-3">
          <StatusDot
            status={
              profile.status === 'verified' ? 'success' : profile.status === 'rejected' ? 'danger' : 'warning'
            }
            label={t(`statuses.${profile.status}`)}
          />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="text-caption text-zinc-600">{t('legalName')}</dt>
            <dd className="text-body">{profile.legalName}</dd>
            <dt className="text-caption text-zinc-600">{t('ein')}</dt>
            <dd className="font-mono text-body">{profile.ein}</dd>
            <dt className="text-caption text-zinc-600">{t('kind')}</dt>
            <dd className="text-body">{t(`kinds.${profile.exemptKind}`)}</dd>
            {profile.sponsorName ? (
              <>
                <dt className="text-caption text-zinc-600">{t('sponsor')}</dt>
                <dd className="text-body">
                  {profile.sponsorName} · <span className="font-mono">{profile.sponsorEin}</span>
                </dd>
              </>
            ) : null}
            {profile.address ? (
              <>
                <dt className="text-caption text-zinc-600">{t('address')}</dt>
                <dd className="text-body">{profile.address}</dd>
              </>
            ) : null}
            <dt className="text-caption text-zinc-600">{t('submitted')}</dt>
            <dd className="text-body">
              {when.format(profile.submittedAt)} UTC · {t('version', { version: profile.version })}
            </dd>
            {profile.reviewNote ? (
              <>
                <dt className="text-caption text-zinc-600">{t('note')}</dt>
                <dd className="text-body">{profile.reviewNote}</dd>
              </>
            ) : null}
          </dl>
        </Card>
      </section>

      <section aria-labelledby="irs-heading" className="flex flex-col gap-3">
        <h2 id="irs-heading" className="text-section">
          {t('irsTitle', { ein: checkedEin })}
        </h2>
        <Card className="flex flex-col gap-3">
          {!irs ? (
            <p className="text-body">{t('irsUnavailable')}</p>
          ) : (
            <>
              <p className="text-caption text-zinc-600">{t(`source.${irs.source}`)}</p>
              {record ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
                  <dt className="text-caption text-zinc-600">{t('irsName')}</dt>
                  <dd className="text-body">
                    {record.name}{' '}
                    <span className="text-caption text-zinc-600">
                      ({nameMatches ? t('nameMatches') : t('nameDiffers')})
                    </span>
                  </dd>
                  <dt className="text-caption text-zinc-600">{t('irsPlace')}</dt>
                  <dd className="text-body">{[record.city, record.state].filter(Boolean).join(', ')}</dd>
                  <dt className="text-caption text-zinc-600">{t('irsSubsection')}</dt>
                  <dd className="font-mono text-body">{record.subsection}</dd>
                  <dt className="text-caption text-zinc-600">{t('irsDeductibility')}</dt>
                  <dd className="font-mono text-body">{record.deductibility}</dd>
                  <dt className="text-caption text-zinc-600">{t('irsStatus')}</dt>
                  <dd className="font-mono text-body">{record.status}</dd>
                </dl>
              ) : null}
              <StatusDot
                status={problem ? 'danger' : 'success'}
                label={problem ? t(`problems.${problem}`) : t('eligible')}
              />
            </>
          )}
        </Card>
      </section>

      {staff.can('charities') ? (
        <section aria-labelledby="verdict-heading" className="flex flex-col gap-3">
          <h2 id="verdict-heading" className="text-section">
            {t('verdictTitle')}
          </h2>
          <Card className="flex flex-col gap-6">
            {!problem && profile.status !== 'verified' ? (
              <form
                action={verifyCharityAction.bind(null, orgId, profile.version)}
                aria-label={t('verifyForm')}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                  <label htmlFor="verify-note" className="text-caption text-zinc-600">
                    {t('verifyNote')}
                  </label>
                  <input id="verify-note" name="note" maxLength={500} className={field} />
                </div>
                <Button type="submit">{t('verify')}</Button>
              </form>
            ) : (
              <p className="text-body text-zinc-600">
                {profile.status === 'verified' ? t('alreadyVerified') : t('cannotVerify')}
              </p>
            )}
            <form
              action={rejectCharityAction.bind(null, orgId, profile.version)}
              aria-label={t('rejectForm')}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                <label htmlFor="reject-note" className="text-caption text-zinc-600">
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
              <Button type="submit" variant="secondary">
                {profile.status === 'verified' ? t('withdraw') : t('reject')}
              </Button>
            </form>
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
