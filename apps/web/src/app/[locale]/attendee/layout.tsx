import { Avatar, buttonClass, Card } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AttendeeNav } from '@/components/attendee-nav.tsx';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
import { initialsOf } from '@/lib/initials.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadAttendee } from '@/server/attendee.ts';
import { dashboardAccess } from '@/server/dashboard-access.ts';
import { requestHost } from '@/server/request-origin.ts';
import { appOrigin } from '@/server/tenant-return.ts';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AttendeeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if ((await requestHost()).kind === 'tenant')
    redirect(`${appOrigin()}${localizedPath(locale, '/attendee')}`);
  const access = await dashboardAccess();
  if (access.kind === 'organizer') redirect(localizedPath(locale, access.href));
  const [data, t] = await Promise.all([loadAttendee(), getTranslations('attendeeDashboard')]);
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Card className="flex flex-col gap-4 lg:sticky lg:top-28">
            <div className="flex min-w-0 items-center gap-3">
              {data.identity ? (
                data.identity.image ? (
                  <img
                    src={data.identity.image}
                    alt={t('profile.photo')}
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <Avatar
                    size={48}
                    label={data.identity.name || data.identity.email}
                    initials={initialsOf(data.identity.name || data.identity.email)}
                    decorative
                  />
                )
              ) : null}
              <div className="min-w-0">
                <p className="text-label uppercase text-ink-2">{t('title')}</p>
                <p className="mt-1 break-words text-body font-bold">
                  {data.identity?.name || data.identity?.email || t('welcome')}
                </p>
              </div>
            </div>
            <AttendeeNav />
            <Link href="/events" className={buttonClass('secondary', 'sm')}>
              {t('browse')}
            </Link>
          </Card>
        </aside>
        <main id="main" className="flex min-w-0 flex-col gap-6">
          {children}
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
