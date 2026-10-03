import { composeNav, type NavItem } from '@yayatoh/platform';
import { Label } from '@yayatoh/ui';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { eventPhase } from '@/lib/event-status.ts';
import { profileMessages } from '@/lib/profile-copy.ts';
import { loadEventBase } from '@/server/console.ts';
import { loadReadiness } from '@/server/readiness.ts';

/** M3.8a: tracked links with the marketing module (read with `marketing:read`). */
const TRACKED_LINKS: NavItem = {
  key: 'trackedLinks',
  path: 'tracked-links',
  group: 'build',
  module: 'marketing',
  icon: 'link',
};

/** M3.2a: the event's Command Center, right after the home page (every profile). */
const COMMAND_CENTER: NavItem = {
  key: 'commandCenter',
  path: 'command-center',
  group: 'overview',
  module: 'core',
  icon: 'gauge',
};

/** M3.3b: the event's help queue (guest and staff requests), with the run items. */
const ASSISTANCE: NavItem = {
  key: 'assistance',
  path: 'assistance',
  group: 'run',
  module: 'checkin',
  icon: 'life-buoy',
};

/** M1.4b: every event can have several dates, a series and copies, whatever its profile. */
const COPY_NAV: readonly NavItem[] = [
  { key: 'dates', path: 'dates', group: 'build', module: 'core', icon: 'calendar-range' },
  { key: 'copy', path: 'copy', group: 'build', module: 'core', icon: 'copy' },
  // M1.4g: ticket holders' reviews and their moderation.
  { key: 'reviews', path: 'reviews', group: 'build', module: 'core', icon: 'star' },
  // M4.2a: the event's co-hosts and planners.
  { key: 'team', path: 'team', group: 'build', module: 'core', icon: 'users' },
];

/** Items only some people may open (the pages refuse everyone else too). */
const NEEDS: Readonly<Record<string, string>> = {
  // The Marketing section holds announcements: hidden without access to messages.
  marketing: 'messages:read',
  team: 'event_team:read',
  trackedLinks: 'marketing:read',
  assistance: 'assistance:read',
};

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, profile, can, opens } = await loadEventBase(org, event);
  const t = await getTranslations();
  const phase = eventPhase(ev.startsAt.toISOString(), ev.endsAt.toISOString());
  // M4.2a: only the sections this person may open (profile routes, team roles, permissions).
  const items = [
    ...composeNav(profile, data.modules).flatMap((i) => (i.key === 'home' ? [i, COMMAND_CENTER] : [i])),
    ...(data.modules.has('marketing') ? [TRACKED_LINKS] : []),
    ...(data.modules.has('checkin') ? [ASSISTANCE] : []),
    ...COPY_NAV,
  ].filter((i) => opens(i.key) && (!NEEDS[i.key] || can(NEEDS[i.key] as string)));
  const rules = opens('setupGuide') ? await loadReadiness(org, event) : [];
  const counted = rules.filter((r) => !r.comingSoon);
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: data.org.name, title: ev.name, href: `/o/${org}/e/${event}` }}
      nav={{
        base: `/o/${org}/e/${event}`,
        profile,
        items,
        badges: { setupGuide: `${counted.filter((r) => r.done).length}/${counted.length}` },
      }}
      status={
        <>
          <Label>
            {t(`eventStatus.${ev.status}`)} · {t(`phase.${phase.phase}`, { days: phase.days })}
          </Label>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-900" />
        </>
      }
    >
      {/* M4.2a: the event's profile rewords the sentences its client components show. */}
      <NextIntlClientProvider messages={profileMessages(await getMessages(), profile)}>
        {children}
      </NextIntlClientProvider>
    </ConsoleShell>
  );
}
