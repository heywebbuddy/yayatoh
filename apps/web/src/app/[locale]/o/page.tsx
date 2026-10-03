import { myOrganizations } from '@yayatoh/tenancy';
import { buttonClass, EmptyState } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation.ts';
import { getSession } from '@/server/session.ts';

/** Entry after sign-in: open the user's first organization. */
export default async function OrgPicker({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  const orgs = await myOrganizations(session.userId);
  // Staff acting as a member (M1.2e) open the org they started from.
  const imp = session.impersonation;
  const first = imp ? orgs.find((o) => o.orgId === imp.orgId) : orgs[0];
  if (first) return redirect({ href: `/o/${first.slug}`, locale });
  const t = await getTranslations('orgPicker');
  return (
    <main id="main" className="mx-auto max-w-xl px-6 py-24">
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={
          <Link href="/my-tickets" className={buttonClass('primary', 'md')}>
            {t('myTickets')}
          </Link>
        }
      />
    </main>
  );
}
