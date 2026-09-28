import { type NavGroup, type NavItem, navLabelKey, type ProfileKey } from '@yayatoh/platform';
import { Avatar, Chip } from '@yayatoh/ui';
import { Menu, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import type { ConsoleData } from '@/server/console.ts';
import { GlobalSearch } from './global-search.tsx';
import { Icon } from './icons.tsx';
import { ImpersonationBanner } from './impersonation-banner.tsx';
import { MediaPicture } from './media-picture.tsx';
import { NotificationCenter } from './notification-center.tsx';
import { OrgStatusBanner } from './org-status-banner.tsx';
import { IncidentBanner } from './status/incident-banner.tsx';
import { SidebarLink } from './sidebar-link.tsx';
import { SignOutButton } from './sign-out-button.tsx';
import { StepUpProvider } from './step-up.tsx';

export interface ShellNav {
  readonly base: string;
  readonly profile: ProfileKey;
  readonly items: readonly NavItem[];
  /** Per-item badges, e.g. setup progress "7/10". */
  readonly badges?: Readonly<Record<string, string>>;
}

const GROUP_ORDER: readonly NavGroup[] = ['overview', 'build', 'run'];

async function SidebarContent({
  data,
  context,
  nav,
}: {
  data: NonNullable<ConsoleData>;
  context: { eyebrow: string; title: string; href: string };
  nav: ShellNav;
}) {
  const t = await getTranslations();
  const groups = GROUP_ORDER.map((g) => nav.items.filter((i) => i.group === g)).filter((g) => g.length > 0);
  return (
    <div className="flex h-full flex-col gap-px">
      <Link
        href="/"
        className="px-2.5 pt-1.5 pb-[18px] text-[21px] font-semibold tracking-[-0.04em] text-zinc-900"
      >
        {t('brand.wordmark')}
      </Link>
      <details className="group relative mb-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-[14px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          {data.logo ? (
            <span
              data-testid="console-logo"
              className="flex size-8 shrink-0 items-center overflow-hidden rounded-[8px] bg-white"
            >
              <MediaPicture image={data.logo} sizes="32px" className="size-8 object-contain" eager />
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-zinc-500">
              {context.eyebrow}
            </span>
            <span className="truncate text-[13px] text-zinc-900">{context.title}</span>
          </span>
          <span className="sr-only">{t('shell.switchContext')}</span>
        </summary>
        <div className="absolute inset-x-0 top-full z-20 mt-1 flex flex-col gap-px rounded-[14px] border border-zinc-200 bg-white p-1.5 shadow-lg">
          <p className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-zinc-500">
            {t('shell.yourOrganizations')}
          </p>
          {data.orgs.map((o) => (
            <Link
              key={o.orgId}
              href={`/o/${o.slug}`}
              className="rounded-[10px] px-2.5 py-2 text-[13px] hover:bg-zinc-50"
            >
              {o.name}
            </Link>
          ))}
        </div>
      </details>
      {groups.map((items, gi) => (
        <div key={items[0]?.group} className="flex flex-col gap-px">
          {gi > 0 ? <div className="mx-2.5 my-2 h-px bg-zinc-200" /> : null}
          {items.map((i) => (
            <SidebarLink key={i.key} href={i.path ? `${nav.base}/${i.path}` : nav.base} exact={!i.path}>
              <Icon name={i.icon} />
              <span className="truncate">{t(navLabelKey(nav.profile, i))}</span>
              {nav.badges?.[i.key] ? <Chip>{nav.badges[i.key]}</Chip> : null}
            </SidebarLink>
          ))}
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 px-2.5 py-2">
        <Avatar initials={data.session.initials} label={data.session.name} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-zinc-900">{data.session.name}</span>
          <span className="text-[12px] text-zinc-500">{t(`roles.${data.role}`)}</span>
        </div>
        {data.session.impersonation ? null : (
          <Link
            href="/account/security"
            aria-label={t('shell.security')}
            title={t('shell.security')}
            className="ms-auto flex size-8 shrink-0 items-center justify-center rounded-pill text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={1.6} />
          </Link>
        )}
        {/* Staff end an impersonation from its banner (audited), not by signing out. */}
        {data.session.impersonation ? null : <SignOutButton />}
      </div>
    </div>
  );
}

/**
 * The console frame (ADR 0018): white sidebar with a zinc-100 active pill, a pill search and the
 * notification centre. Below `lg` the sidebar collapses into a disclosure menu.
 */
export async function ConsoleShell({
  data,
  context,
  nav,
  status,
  children,
}: {
  data: NonNullable<ConsoleData>;
  context: { eyebrow: string; title: string; href: string };
  nav: ShellNav;
  status?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations('shell');
  const sidebar = <SidebarContent data={data} context={context} nav={nav} />;
  return (
    <div className="flex min-h-dvh bg-zinc-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-pill focus:bg-white focus:px-4 focus:py-2"
      >
        {t('skipToContent')}
      </a>
      <nav
        aria-label={t('navigation')}
        className="sticky top-0 hidden h-dvh w-[248px] shrink-0 border-e border-zinc-200 bg-white px-3 py-[18px] lg:block"
      >
        {sidebar}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <ImpersonationBanner session={data.session} locale={data.ctx.locale} timeZone={data.org.timezone} />
        <OrgStatusBanner status={data.org.status} />
        <IncidentBanner variant="console" />
        <header className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-8 md:pt-[26px]">
          <details className="lg:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-pill border border-zinc-200 bg-white [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="size-4" strokeWidth={1.6} />
              <span className="sr-only">{t('menu')}</span>
            </summary>
            <nav
              aria-label={t('navigation')}
              className="fixed inset-y-0 start-0 z-40 w-[280px] overflow-y-auto border-e border-zinc-200 bg-white px-3 py-[18px] shadow-xl"
            >
              {sidebar}
            </nav>
          </details>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">{status}</div>
          <GlobalSearch org={data.org.slug} label={t('search')} placeholder={t('searchPlaceholder')} />
          <NotificationCenter data={data} />
        </header>
        <main id="main" className="flex flex-col gap-[18px] px-4 pt-5 pb-10 md:px-8">
          <StepUpProvider>{children}</StepUpProvider>
        </main>
      </div>
    </div>
  );
}
