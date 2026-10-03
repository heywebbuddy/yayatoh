import { publicOrganizerById } from '@yayatoh/marketplace';
import { buyerOrdersInOrg } from '@yayatoh/orders';
import { buttonClass, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TenantHeader } from '@/components/cms/tenant-header.tsx';
import { localizedPath } from '@/lib/seo/urls.ts';
import { pageLocale } from '@/server/locale.ts';
import { getSession } from '@/server/session.ts';
import { appOrigin } from '@/server/tenant-return.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Props = { params: Promise<{ locale: string; org: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'yourTickets' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * "Your tickets" on a tenant site (M1.2f, `{org host}/tickets`): the orders the signed-in person
 * placed at this organizer, each with its own manage link. Signed out: sign in (through the app
 * host). Only this host's session and this org's orders; nothing about other organizers.
 */
export default async function YourTickets({ params }: Props) {
  const { locale, org } = await params;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  const o = orgId ? await publicOrganizerById(orgId) : null;
  if (!orgId || !o) notFound();
  const t = await getTranslations('yourTickets');
  const session = await getSession();
  const rows = session ? await buyerOrdersInOrg(orgId, session.userId) : [];
  return (
    <div className="min-h-dvh bg-surface">
      <TenantHeader org={o} current="/tickets" />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
        <PageHeader eyebrow={<Label>{o.name}</Label>} title={t('title')} />
        {!session ? (
          <Card className="flex flex-col gap-3">
            <p className="text-body text-ink-2">{t('signedOut', { org: o.name })}</p>
            <a
              href={`${localizedPath(locale, '/sign-in')}?next=${encodeURIComponent(localizedPath(locale, '/tickets'))}`}
              className={buttonClass('primary', 'md', 'self-start')}
            >
              {t('signIn')}
            </a>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription', { org: o.name })} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {rows.map((r) => {
              const when = new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: r.timezone,
              }).format(r.startsAt);
              return (
                <li key={r.orderId}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <a
                        href={localizedPath(locale, `/events/${r.eventSlug}`)}
                        className="text-body underline-offset-4 hover:underline"
                      >
                        {r.eventName}
                      </a>
                      <span className="text-caption text-ink-2">
                        {when} · {t(`status.${r.status}`)}
                      </span>
                    </div>
                    {r.manageToken ? (
                      <a
                        href={`${appOrigin()}${localizedPath(locale, `/orders/${r.manageToken}`)}`}
                        className={buttonClass('secondary', 'sm')}
                        aria-label={t('openNamed', { event: r.eventName })}
                      >
                        {t('open')}
                      </a>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
