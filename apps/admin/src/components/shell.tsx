import {
  Activity,
  BadgeCheck,
  Building2,
  ChartColumn,
  DoorOpen,
  KeyRound,
  MessageSquareWarning,
  Percent,
  Route,
  ScrollText,
  Send,
  Siren,
  Store,
  TicketCheck,
  UserRoundSearch,
  Wrench,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { autoPausedOrgs } from '@/server/messaging-policy.ts';
import type { Staff } from '@/server/staff.ts';
import { currentTheme } from '@/server/theme.ts';
import { NavLink } from './nav-link.tsx';
import { SignOutButton } from './sign-out-button.tsx';
import { ThemeSwitch } from './theme-switch.tsx';

const I = { 'aria-hidden': true, strokeWidth: 2 } as const;

/**
 * The staff console frame (ADR 0022): the floating dark sidebar on wide screens, a scrolling
 * strip of the same links on phones (one nav, so every link exists once), who is signed in and
 * as what, the theme switch and sign out.
 */
export async function Shell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const t = await getTranslations('shell');
  // Staff hear about complaint-rate auto-pauses here (M3.5a): the count sits in the nav.
  const paused = staff.can('messaging') ? (await autoPausedOrgs(staff)).length : 0;
  const theme = await currentTheme();
  const links: { href: string; label: string; icon: ReactNode; show: boolean }[] = [
    { href: '/', label: t('tenants'), icon: <Building2 {...I} />, show: true },
    { href: '/commission', label: t('commission'), icon: <Percent {...I} />, show: staff.can('fees') },
    { href: '/reports', label: t('reports'), icon: <ChartColumn {...I} />, show: staff.can('reports') },
    {
      href: '/signup-codes',
      label: t('signupCodes'),
      icon: <TicketCheck {...I} />,
      show: staff.can('signupCodes'),
    },
    {
      href: '/open-signup',
      label: t('openSignup'),
      icon: <DoorOpen {...I} />,
      show: staff.can('openSignup'),
    },
    { href: '/people', label: t('people'), icon: <UserRoundSearch {...I} />, show: staff.can('privacy') },
    // M4.8b: charity profiles waiting for verification against the IRS list.
    {
      href: '/charities',
      label: t('charities'),
      icon: <BadgeCheck {...I} />,
      show: staff.can('charities'),
    },
    // M6.14a: marketplace listing moderation (hide or show again, with a reason).
    { href: '/listings', label: t('listings'), icon: <Store {...I} />, show: staff.can('listings') },
    {
      href: '/messaging',
      label: paused ? t('messagingCount', { count: paused }) : t('messaging'),
      icon: <MessageSquareWarning {...I} />,
      show: staff.can('messaging'),
    },
    { href: '/incidents', label: t('incidents'), icon: <Siren {...I} />, show: staff.can('incidents') },
    {
      href: '/maintenance',
      label: t('maintenance'),
      icon: <Wrench {...I} />,
      show: staff.can('maintenance'),
    },
    { href: '/providers', label: t('providers'), icon: <Send {...I} />, show: staff.can('messaging') },
    { href: '/access-log', label: t('accessLog'), icon: <ScrollText {...I} />, show: true },
    { href: '/api-usage', label: t('apiUsage'), icon: <Activity {...I} />, show: true },
    { href: '/front-door', label: t('frontDoor'), icon: <Route {...I} />, show: true },
    { href: '/security', label: t('passkeys'), icon: <KeyRound {...I} />, show: true },
  ];
  return (
    <div className="min-h-dvh lg:flex lg:gap-5 lg:p-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface-solid focus:px-4 focus:py-2.5 focus:font-bold"
      >
        {t('skip')}
      </a>
      <aside className="m-3 flex flex-col gap-4 rounded-panel border border-side-line bg-side p-4 text-side-ink lg:sticky lg:top-4 lg:m-0 lg:h-[calc(100dvh-2rem)] lg:w-[256px] lg:shrink-0 lg:gap-5 lg:overflow-y-auto lg:px-4 lg:pt-6 dark:backdrop-blur-xl [&_:focus-visible]:outline-white">
        <header className="flex items-center gap-2.5 px-2">
          <svg aria-hidden="true" viewBox="0 0 32 32" className="size-[28px] shrink-0">
            <path d="M5 21C5 13.3 10.6 6 18.5 6c0 7.7-5.6 15-13.5 15z" className="fill-brand" />
            <path
              d="M27 11c0 7.7-5.6 15-13.5 15 0-7.7 5.6-15 13.5-15z"
              className="fill-primary"
              fillOpacity="0.92"
            />
          </svg>
          <span className="text-[18px] font-extrabold tracking-[-0.02em] text-side-strong">
            {t('product')}
          </span>
        </header>
        <nav
          aria-label={t('nav')}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {links
            .filter((l) => l.show)
            .map((l) => (
              <NavLink key={l.href} href={l.href} icon={l.icon}>
                {l.label}
              </NavLink>
            ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-side-line bg-side-tile p-2.5 lg:mt-auto">
          <span className="min-w-0 grow px-1 text-caption text-side-ink">
            {t('signedInAs', { name: staff.name, role: t(`roles.${staff.role}`) })}
          </span>
          <ThemeSwitch initial={theme} />
          <SignOutButton label={t('signOut')} onDark />
        </div>
      </aside>
      <main
        id="main"
        className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 pt-2 pb-12 lg:px-2 lg:pt-3"
      >
        {children}
      </main>
    </div>
  );
}
