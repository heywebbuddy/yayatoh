import type { SpeakerPortalDto } from '@yayatoh/program';
import { Label, PageHeader } from '@yayatoh/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { portalSignOutAction } from '@/app/[locale]/event-portal/actions.ts';
import { PortalSignOutButton } from '@/components/portal-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';

export type PortalSection = 'overview' | 'profile' | 'tasks';

/**
 * The speaker portal's frame (M5.3a): the event (dates in its own time zone), the three sections
 * and sign out. Outside the organizer console: a portal account has no console.
 */
export async function PortalShell({
  data,
  active,
  title,
  children,
}: {
  data: SpeakerPortalDto;
  active: PortalSection | null;
  title: string;
  children: ReactNode;
}) {
  const t = await getTranslations('speakerPortal');
  const locale = await getLocale();
  const items: { key: PortalSection; href: string }[] = [
    { key: 'overview', href: '/event-portal' },
    { key: 'profile', href: '/event-portal/profile' },
    { key: 'tasks', href: '/event-portal/tasks' },
  ];
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>{t('title')}</Label>
          <PortalSignOutButton action={portalSignOutAction} />
        </div>
        <nav aria-label={t('navLabel')}>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {items.map((i) => (
              <li key={i.key}>
                <Link
                  href={i.href}
                  aria-current={active === i.key ? 'page' : undefined}
                  className={`inline-flex min-h-10 items-center rounded-pill px-4 text-body ${
                    active === i.key
                      ? 'bg-zinc-900 text-white'
                      : 'border border-zinc-200 bg-white text-zinc-700'
                  }`}
                >
                  {t(`nav.${i.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="flex flex-col gap-6">
        <PageHeader
          eyebrow={<Label>{data.event.name}</Label>}
          title={title}
          description={t('eventDates', {
            dates: formatEventDateRange(data.event.startsAt.toISOString(), data.event.endsAt.toISOString(), {
              locale,
              currency: 'USD',
              timeZone: data.event.timezone,
            }),
            zone: data.event.timezone,
          })}
        />
        {children}
      </main>
    </div>
  );
}

/** Nobody signed in on this host: the portal is reached through the invitation email. */
export async function PortalSignedOut({ signedOut }: { signedOut?: boolean }) {
  const t = await getTranslations('speakerPortal');
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader
        eyebrow={<Label>{t('title')}</Label>}
        title={signedOut ? t('signedOutDone') : t('signedOutTitle')}
      />
      <p className="text-body text-zinc-700">{t('signedOutDescription')}</p>
    </main>
  );
}
