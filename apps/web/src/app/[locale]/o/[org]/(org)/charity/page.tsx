import { type CharityProfileDto, charityProfileQuery } from '@yayatoh/donations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { saveCharityAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('charity');
  return { title: t('title') };
}

/**
 * The org's charity profile (M4.8b, P4-11): legal name, EIN, how it is exempt (its own 501(c)(3)
 * status or a fiscal sponsor's) and an address for receipts. Yayatoh staff verify it against the
 * IRS exempt-organization list; until then every receipt says "This payment is not
 * tax-deductible". Every member reads it; owners and admins (`org:update`) change it.
 */
export default async function CharityPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('charity');
  let profile: CharityProfileDto | null;
  try {
    profile = await executeQuery(charityProfileQuery, {}, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && (err.code === 'module_not_enabled' || err.code === 'forbidden'))
      return (
        <>
          <PageHeader title={t('title')} />
          <EmptyState title={t('unavailableTitle')} description={t('unavailableDescription')} />
        </>
      );
    throw err;
  }
  const canEdit = roleCan(data.role, 'org:update');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const fields: FieldSpec[] = [
    {
      kind: 'text',
      name: 'legalName',
      label: t('legalName'),
      hint: t('legalNameHint'),
      required: true,
      maxLength: 200,
      defaultValue: profile?.legalName,
    },
    {
      kind: 'text',
      name: 'ein',
      label: t('ein'),
      hint: t('einHint'),
      required: true,
      maxLength: 20,
      defaultValue: profile?.ein,
    },
    {
      kind: 'select',
      name: 'exemptKind',
      label: t('exemptKind'),
      options: [
        { value: '501c3', label: t('exempt501c3') },
        { value: 'fiscal_sponsor', label: t('exemptSponsor') },
      ],
      defaultValue: profile?.exemptKind ?? '501c3',
    },
    {
      kind: 'text',
      name: 'sponsorName',
      label: t('sponsorName'),
      hint: t('sponsorHint'),
      maxLength: 200,
      defaultValue: profile?.sponsorName ?? undefined,
    },
    {
      kind: 'text',
      name: 'sponsorEin',
      label: t('sponsorEin'),
      maxLength: 20,
      defaultValue: profile?.sponsorEin ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'address',
      label: t('address'),
      hint: t('addressHint'),
      rows: 2,
      defaultValue: profile?.address ?? undefined,
    },
  ];
  const errors = {
    legalName: t('errors.legalName'),
    ein: t('errors.ein'),
    sponsorName: t('errors.sponsorName'),
    sponsorEin: t('errors.sponsorEin'),
    address: t('errors.address'),
  };
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <section aria-labelledby="charity-status" className="flex flex-col gap-3">
        <h2 id="charity-status" className="text-section">
          {t('statusTitle')}
        </h2>
        {!profile ? (
          <EmptyState
            title={t('emptyTitle')}
            description={canEdit ? t('emptyDescription') : t('emptyViewer')}
          />
        ) : (
          <Card className="flex flex-col gap-2">
            <StatusDot
              status={
                profile.status === 'verified'
                  ? 'success'
                  : profile.status === 'rejected'
                    ? 'danger'
                    : 'warning'
              }
              label={t(`status.${profile.status}`)}
            />
            <p className="text-body text-ink-2">
              {profile.status === 'verified'
                ? t('verifiedBody', { at: profile.reviewedAt ? when.format(profile.reviewedAt) : '' })
                : profile.status === 'rejected'
                  ? t('rejectedBody')
                  : t('pendingBody', { at: when.format(profile.submittedAt) })}
            </p>
            {profile.status === 'rejected' && profile.reviewNote ? (
              <Alert title={t('reviewNote')}>
                <p>{profile.reviewNote}</p>
              </Alert>
            ) : null}
          </Card>
        )}
        <p className="text-caption text-ink-2">{t('receiptsNote')}</p>
      </section>
      <section aria-labelledby="charity-details" className="flex flex-col gap-3">
        <h2 id="charity-details" className="text-section">
          {t('detailsTitle')}
        </h2>
        {canEdit ? (
          <Card size="panel">
            <ProgramForm
              action={saveCharityAction.bind(null, org)}
              fields={fields}
              idPrefix="charity"
              submitLabel={profile ? t('saveAndReview') : t('submit')}
              successLabel={t('saved')}
              errors={errors}
            />
          </Card>
        ) : profile ? (
          <Card>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
              <dt className="text-caption text-ink-2">{t('legalName')}</dt>
              <dd className="text-body">{profile.legalName}</dd>
              <dt className="text-caption text-ink-2">{t('ein')}</dt>
              <dd className="text-body">{profile.ein}</dd>
              <dt className="text-caption text-ink-2">{t('exemptKind')}</dt>
              <dd className="text-body">
                {profile.exemptKind === '501c3' ? t('exempt501c3') : t('exemptSponsor')}
              </dd>
              {profile.sponsorName ? (
                <>
                  <dt className="text-caption text-ink-2">{t('sponsorName')}</dt>
                  <dd className="text-body">
                    {profile.sponsorName} · {profile.sponsorEin}
                  </dd>
                </>
              ) : null}
            </dl>
            <p className="mt-3 text-caption text-ink-2">{t('viewerNotice')}</p>
          </Card>
        ) : null}
      </section>
    </>
  );
}
