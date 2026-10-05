import type { SpeakerPortalDto } from '@yayatoh/program';
import { cx, Label, PageHeader, Tag } from '@yayatoh/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { portalSignOutAction } from '@/app/[locale]/event-portal/actions.ts';
import { AuthBar } from '@/components/auth-bar.tsx';
import { PortalSignOutButton } from '@/components/portal-forms.tsx';
import { ThemeSwitch } from '@/components/theme-switch.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { initialsOf } from '@/lib/initials.ts';
import { currentTheme } from '@/server/theme.ts';

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
    <PortalFrame
      eventName={data.event.name}
      nav={
        <nav aria-label={t('navLabel')} className="flex grow flex-wrap gap-1">
          {items.map((i) => (
            <Link
              key={i.key}
              href={i.href}
              aria-current={active === i.key ? 'page' : undefined}
              className={portalNavClass(active === i.key)}
            >
              {t(`nav.${i.key}`)}
            </Link>
          ))}
        </nav>
      }
    >
      <PageHeader
        eyebrow={<Label>{t('title')}</Label>}
        title={title}
        tag={<Tag>{data.event.name}</Tag>}
        meta={
          <span>
            {t('eventDates', {
              dates: formatEventDateRange(
                data.event.startsAt.toISOString(),
                data.event.endsAt.toISOString(),
                {
                  locale,
                  currency: 'USD',
                  timeZone: data.event.timezone,
                },
              ),
              zone: data.event.timezone,
            })}
          </span>
        }
      />
      {children}
    </PortalFrame>
  );
}

/** A portal top-bar link: the current section is the dark tag colour (ADR 0022). */
export function portalNavClass(active: boolean): string {
  return cx(
    'inline-flex min-h-10 items-center rounded-[10px] px-3 text-body font-bold transition-colors duration-150',
    active ? 'bg-tag text-tag-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  );
}

/**
 * The frame of every signed-in portal page (speakers M5.3a, exhibitors M5.4a; ADR 0022): a glass
 * top bar with the event mark and name, the sections, the theme switch and sign out, then the
 * page. Outside the organizer console: a portal account has no console.
 */
export async function PortalFrame({
  eventName,
  nav,
  children,
}: {
  eventName: string;
  nav?: ReactNode;
  children: ReactNode;
}) {
  const theme = await currentTheme();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] border border-line bg-surface p-2.5 ps-4 elevation-card glass">
        <span className="flex min-w-0 items-center gap-2.5 text-ink">
          <span
            aria-hidden="true"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-brand-strong text-[13px] font-extrabold text-white"
          >
            {initialsOf(eventName)}
          </span>
          <span className="truncate text-[17px] font-extrabold tracking-[-0.02em]">{eventName}</span>
        </span>
        {nav ?? <span className="grow" />}
        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitch initial={theme} />
          <PortalSignOutButton action={portalSignOutAction} />
        </div>
      </header>
      <main id="main" className="flex flex-col gap-6">
        {children}
      </main>
    </div>
  );
}

/**
 * The portal's signed-out pages (invitation, sign-in, magic link; ADR 0022): the sign-in frame
 * (wordmark and theme switch), a centred column with the page header and one panel.
 */
export function PortalAuthFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col justify-center gap-6 px-6 py-16"
      >
        {children}
      </main>
    </>
  );
}

/** Nobody signed in on this host: the portal is reached through the invitation email. */
export async function PortalSignedOut({ signedOut }: { signedOut?: boolean }) {
  const t = await getTranslations('speakerPortal');
  // One portal sign-in for every role (speakers, exhibitor admins and staff): no role named here.
  const ts = await getTranslations('portalSignIn');
  return (
    <PortalAuthFrame>
      <PageHeader
        title={signedOut ? t('signedOutDone') : ts('title')}
        description={t('signedOutDescription')}
      />
    </PortalAuthFrame>
  );
}
