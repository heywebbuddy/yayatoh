import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { organizationNameTx } from '@yayatoh/tenancy';
import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SelfRequestForm } from '@/components/privacy-self-request.tsx';
import { Link } from '@/i18n/navigation.ts';
import { privacyOrg } from '@/server/privacy-request.ts';
import { selfRequestAction } from './actions.ts';

export const metadata: Metadata = { robots: { index: false } };

/**
 * Ask an organizer about your personal data (M6.1c): a copy, or erasure. The person proves the
 * address with an emailed code; the org answers within 30 days. Phone-first, public, no sign-in.
 */
export default async function PrivacyRequestPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const found = await privacyOrg(org);
  if (!found) notFound();
  const name =
    (await withTenant(createCtx({ orgId: found.orgId, actor: { type: 'system', name: 'privacy.self-service' } }), (tx) =>
      organizationNameTx(tx, found.orgId),
    )) ?? org;
  const t = await getTranslations('privacyRequest');
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16">
      <PageHeader
        eyebrow={<Label>{name}</Label>}
        title={t('title')}
        description={t('description', { org: name })}
      />
      <SelfRequestForm action={selfRequestAction.bind(null, org)} org={name} />
      <p className="text-body text-ink-2">
        <Link href={`/legal/${org}/privacy`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          {t('notice', { org: name })}
        </Link>
      </p>
    </main>
  );
}
