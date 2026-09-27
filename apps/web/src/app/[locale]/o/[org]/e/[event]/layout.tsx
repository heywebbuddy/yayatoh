import { composeNav } from '@yayatoh/platform';
import { Label } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { demoEvent } from '@/demo/events.ts';
import { eventPhase } from '@/lib/event-status.ts';
import { loadConsole } from '@/server/console.ts';

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const ev = demoEvent(org, event);
  if (!ev) notFound();
  const t = await getTranslations();
  const phase = eventPhase(ev.startsAt, ev.endsAt);
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: data.org.name, title: ev.name, href: `/o/${org}/e/${event}` }}
      nav={{
        base: `/o/${org}/e/${event}`,
        profile: ev.profile,
        items: composeNav(ev.profile, data.modules),
        badges: { setupGuide: `${ev.setupDone}/${ev.setupTotal}` },
      }}
      status={
        <>
          <Label>{t(`phase.${phase.phase}`, { days: phase.days })}</Label>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-900" />
        </>
      }
    >
      {children}
    </ConsoleShell>
  );
}
