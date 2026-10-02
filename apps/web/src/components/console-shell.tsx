import { type NavGroup, type NavItem, navLabelKey, type ProfileKey } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Avatar, buttonClass, type Crumb, cx, NavSection } from '@yayatoh/ui';
import { ChevronsUpDown, Plus, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import type { ConsoleData } from '@/server/console.ts';
import { currentTheme } from '@/server/theme.ts';
import { BrandMark } from './brand-mark.tsx';
import { Crumbs } from './crumbs.tsx';
import { GlobalSearch } from './global-search.tsx';
import { Icon } from './icons.tsx';
import { ImpersonationBanner } from './impersonation-banner.tsx';
import { MaintenanceBanner } from './maintenance-banner.tsx';
import { MediaPicture } from './media-picture.tsx';
import { MobileNav } from './mobile-nav.tsx';
import { NotificationCenter } from './notification-center.tsx';
import { OrgStatusBanner } from './org-status-banner.tsx';
import { SidebarLink } from './sidebar-link.tsx';
import { SignOutButton } from './sign-out-button.tsx';
import { IncidentBanner } from './status/incident-banner.tsx';
import { StepUpProvider } from './step-up.tsx';
import { ThemeSwitch } from './theme-switch.tsx';

export interface ShellNav {
  readonly base: string;
  readonly profile: ProfileKey;
  readonly items: readonly NavItem[];
  /** Per-item badges, e.g. setup progress "7/10". */
  readonly badges?: Readonly<Record<string, string>>;
}

const GROUP_ORDER: readonly NavGroup[] = ['overview', 'build', 'run'];

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Icon actions on the dark sidebar (security, sign out). */
const SIDE_ACTION =
  'flex size-9 shrink-0 items-center justify-center rounded-[12px] text-side-ink hover:bg-side-hover hover:text-side-strong';

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
  const canCreate = roleCan(data.role, 'events:write');
  const who = data.session.name || data.session.email;
  return (
    <div className="flex min-h-full flex-col gap-5 [&_:focus-visible]:outline-white">
      <Link
        href="/"
        className="flex items-center gap-2.5 self-start rounded-control px-2 py-0.5 text-[21px] font-extrabold tracking-[-0.02em] text-side-strong"
      >
        <BrandMark />
        {t('brand.wordmark')}
      </Link>
      <details className="group/org relative">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-[16px] border border-side-line bg-side-tile px-3 py-2 text-side-strong transition-colors duration-150 hover:bg-side-hover [&::-webkit-details-marker]:hidden">
          {data.logo ? (
            <span
              data-testid="console-logo"
              className="flex size-8 shrink-0 items-center overflow-hidden rounded-[9px] bg-white"
            >
              <MediaPicture image={data.logo} sizes="32px" className="size-8 object-contain" eager />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-strong text-caption font-extrabold text-white"
            >
              {initialsOf(data.org.name)}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[10px] font-extrabold tracking-[0.1em] text-side-label uppercase">
              {context.eyebrow}
            </span>
            <span className="truncate text-body font-semibold">{context.title}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-side-ink" strokeWidth={2} />
          <span className="sr-only">{t('shell.switchContext')}</span>
        </summary>
        <div className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col gap-0.5 rounded-tile border border-line bg-surface-solid p-1.5 text-ink elevation-pop [&_:focus-visible]:outline-focus">
          <p className="px-2.5 py-1.5 text-label tracking-[0.12em] text-ink-2 uppercase">
            {t('shell.yourOrganizations')}
          </p>
          {data.orgs.map((o) => (
            <Link
              key={o.orgId}
              href={`/o/${o.slug}`}
              aria-current={o.slug === data.org.slug ? 'true' : undefined}
              className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-body font-semibold hover:bg-surface-3 aria-[current=true]:text-primary-ink"
            >
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-surface-3 text-[10px] font-extrabold text-ink-2"
              >
                {initialsOf(o.name)}
              </span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{o.name}</span>
            </Link>
          ))}
        </div>
      </details>
      <div className="flex flex-col gap-4">
        {groups.map((items, gi) => {
          const rows = items.map((i) => (
            <SidebarLink
              key={i.key}
              href={i.path ? `${nav.base}/${i.path}` : nav.base}
              exact={!i.path}
              icon={<Icon name={i.icon} className="size-[17px]" />}
              badge={nav.badges?.[i.key]}
            >
              {t(navLabelKey(nav.profile, i))}
            </SidebarLink>
          ));
          return gi === 0 ? (
            <NavSection key={items[0]?.group} label={t('shell.menuSection')}>
              {rows}
            </NavSection>
          ) : (
            <div key={items[0]?.group} className="flex flex-col gap-1 border-t border-side-line pt-4">
              {rows}
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <p className="px-2.5 text-label tracking-[0.12em] text-side-label uppercase">
          {t('shell.accountSection')}
        </p>
        <div className="flex flex-col gap-3.5 rounded-[22px] border border-side-line bg-side-tile p-3.5">
          <div className="flex items-center gap-2.5">
            {/* An account made with an emailed code may have no name yet: the address stands in. */}
            <Avatar initials={data.session.initials} label={who} size={38} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-bold text-side-strong">{who}</span>
              <span className="truncate text-caption text-side-ink">
                {t(`roles.${data.role}`)} · {data.org.name}
              </span>
            </div>
            {data.session.impersonation ? null : (
              <Link
                href="/account/security"
                aria-label={t('shell.security')}
                title={t('shell.security')}
                className={SIDE_ACTION}
              >
                <ShieldCheck aria-hidden="true" className="size-[18px]" strokeWidth={2} />
              </Link>
            )}
            {/* Staff end an impersonation from its banner (audited), not by signing out. */}
            {data.session.impersonation ? null : <SignOutButton className={SIDE_ACTION} />}
          </div>
          {canCreate ? (
            <Link
              href={`/o/${data.org.slug}/events/new/guided`}
              className={cx(buttonClass('primary', 'md'), 'w-full')}
            >
              <Plus aria-hidden="true" strokeWidth={2.4} />
              {t('shell.newEvent')}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const SIDEBAR =
  'flex-col overflow-y-auto rounded-panel border border-side-line bg-side px-4 pt-6 pb-4 text-side-ink dark:backdrop-blur-xl';

/**
 * The console frame (ADR 0022): a floating near-black sidebar (rounded 28, inset 16) with the org
 * switcher, MENU and ACCOUNT sections and the "New event" action; a topbar with search (⌘K or /),
 * the theme switch and notifications. Below 1024 px the sidebar is a drawer.
 */
export async function ConsoleShell({
  data,
  context,
  nav,
  status,
  crumbs,
  children,
}: {
  data: NonNullable<ConsoleData>;
  context: { eyebrow: string; title: string; href: string };
  nav: ShellNav;
  status?: ReactNode;
  /** Where this page sits (e.g. the org and the event), shown above every page's header. */
  crumbs?: readonly Crumb[];
  children: ReactNode;
}) {
  const t = await getTranslations('shell');
  const theme = await currentTheme();
  const sidebar = <SidebarContent data={data} context={context} nav={nav} />;
  return (
    <div className="min-h-dvh lg:flex lg:gap-5 lg:p-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-surface-solid focus:px-4 focus:py-2.5 focus:font-bold focus:elevation-pop"
      >
        {t('skipToContent')}
      </a>
      <nav
        aria-label={t('navigation')}
        className={cx(SIDEBAR, 'sticky top-4 hidden h-[calc(100dvh-2rem)] w-[260px] shrink-0 lg:flex')}
      >
        {sidebar}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-4 pb-12 md:px-6 lg:px-1.5 lg:pt-1.5">
        <ImpersonationBanner session={data.session} locale={data.ctx.locale} timeZone={data.org.timezone} />
        <MaintenanceBanner orgId={data.org.id} locale={data.ctx.locale} timeZone={data.org.timezone} />
        <OrgStatusBanner status={data.org.status} />
        <IncidentBanner variant="console" />
        <header className="relative z-30 flex flex-wrap items-center gap-2.5">
          <MobileNav openLabel={t('menu')} closeLabel={t('closeMenu')}>
            <nav
              aria-label={t('navigation')}
              className={cx(
                SIDEBAR,
                'fixed inset-y-3 start-3 z-50 flex w-[min(300px,calc(100vw-1.5rem))] elevation-pop',
              )}
            >
              {sidebar}
            </nav>
          </MobileNav>
          <GlobalSearch org={data.org.slug} label={t('search')} placeholder={t('searchPlaceholder')} />
          {status ? <div className="flex min-w-0 items-center gap-2.5">{status}</div> : null}
          <div className="ms-auto flex items-center gap-2.5">
            <ThemeSwitch initial={theme} />
            <NotificationCenter data={data} />
          </div>
        </header>
        <main id="main" className="flex min-w-0 flex-col gap-5">
          {crumbs ? (
            <div className="-mb-2">
              <Crumbs items={crumbs} />
            </div>
          ) : null}
          <StepUpProvider>{children}</StepUpProvider>
        </main>
      </div>
    </div>
  );
}
