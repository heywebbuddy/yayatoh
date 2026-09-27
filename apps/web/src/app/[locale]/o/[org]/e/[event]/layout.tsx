import { composeNav, isProfileKey } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Label } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { eventPhase } from '@/lib/event-status.ts';
import { readinessRules } from '@/lib/readiness.ts';
import { loadEvent } from '@/server/console.ts';

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations();
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const phase = eventPhase(ev.startsAt.toISOString(), ev.endsAt.toISOString());
  const rules = readinessRules(ev);
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: data.org.name, title: ev.name, href: `/o/${org}/e/${event}` }}
      nav={{
        base: `/o/${org}/e/${event}`,
        profile,
        // The Marketing section holds announcements: hidden without access to messages.
        items: composeNav(profile, data.modules).filter(
          (i) => i.key !== 'marketing' || roleCan(data.role, 'messages:read'),
        ),
        badges: { setupGuide: `${rules.filter((r) => r.done).length}/${rules.length}` },
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
      {children}
    </ConsoleShell>
  );
}
