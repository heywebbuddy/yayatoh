import { type CharityProfileDto, charityProfileQuery } from '@yayatoh/donations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, EmptyState, PageHeader, SectionHeader, StatusPill } from '@yayatoh/ui';
import { BadgeCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
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
  const tn = await getTranslations('nav');
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: tn('settings'), href: `/o/${org}/settings` },
        { label: t('title') },
      ]}
    />
  );
  let profile: CharityProfileDto | null;
  try {
    profile = await executeQuery(charityProfileQuery, {}, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && (err.code === 'module_not_enabled' || err.code === 'forbidden'))
      return (
        <>
          <PageHeader breadcrumb={crumbs} title={t('title')} />
          <EmptyState
            icon={<BadgeCheck strokeWidth={2} />}
            title={t('unavailableTitle')}
            description={t('unavailableDescription')}
          />
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
  const statusTone = { verified: 'success', rejected: 'danger', pending: 'waiting' } as const;
  const term = 'text-caption font-bold text-ink-2';
  const value = 'm-0 text-body text-ink';
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('description')} />
      <section aria-labelledby="charity-status" className="flex flex-col gap-4">
        <SectionHeader id="charity-status" title={t('statusTitle')} description={t('receiptsNote')} />
        {!profile ? (
          <EmptyState
            icon={<BadgeCheck strokeWidth={2} />}
            title={t('emptyTitle')}
            description={canEdit ? t('emptyDescription') : t('emptyViewer')}
          />
        ) : (
          <Card size="panel" className="flex flex-col gap-3">
            <StatusPill
              tone={statusTone[profile.status]}
              label={t(`status.${profile.status}`)}
              className="self-start"
            />
            <p className="m-0 text-body text-ink-2">
              {profile.status === 'verified'
                ? t('verifiedBody', { at: profile.reviewedAt ? when.format(profile.reviewedAt) : '' })
                : profile.status === 'rejected'
                  ? t('rejectedBody')
                  : t('pendingBody', { at: when.format(profile.submittedAt) })}
            </p>
            {profile.status === 'rejected' && profile.reviewNote ? (
              <Alert title={t('reviewNote')}>
                <p className="m-0">{profile.reviewNote}</p>
              </Alert>
            ) : null}
          </Card>
        )}
      </section>
      <section aria-labelledby="charity-details" className="flex flex-col gap-4">
        <SectionHeader id="charity-details" title={t('detailsTitle')} />
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
        ) : (
          <>
            <Alert tone="info" title={t('viewerNotice')} />
            {profile ? (
              <Card size="panel">
                <dl className="m-0 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
                  <dt className={term}>{t('legalName')}</dt>
                  <dd className={value}>{profile.legalName}</dd>
                  <dt className={term}>{t('ein')}</dt>
                  <dd className={`${value} tabular-nums`}>{profile.ein}</dd>
                  <dt className={term}>{t('exemptKind')}</dt>
                  <dd className={value}>
                    {profile.exemptKind === '501c3' ? t('exempt501c3') : t('exemptSponsor')}
                  </dd>
                  {profile.sponsorName ? (
                    <>
                      <dt className={term}>{t('sponsorName')}</dt>
                      <dd className={value}>
                        {profile.sponsorName} · <span className="tabular-nums">{profile.sponsorEin}</span>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </Card>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
