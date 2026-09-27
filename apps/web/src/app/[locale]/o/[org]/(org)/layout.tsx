import type { NavItem } from '@yayatoh/platform';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { loadConsole } from '@/server/console.ts';

const ORG_NAV: readonly NavItem[] = [
  { key: 'home', path: '', group: 'overview', module: 'core', icon: 'home' },
  { key: 'team', path: 'team', group: 'build', module: 'core', icon: 'users' },
  { key: 'series', path: 'series', group: 'build', module: 'core', icon: 'layers' },
  { key: 'templates', path: 'templates', group: 'build', module: 'core', icon: 'copy' },
  { key: 'domains', path: 'domains', group: 'build', module: 'core', icon: 'globe' },
  { key: 'payouts', path: 'payouts', group: 'build', module: 'core', icon: 'landmark' },
  { key: 'settings', path: 'settings', group: 'build', module: 'core', icon: 'settings' },
];

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('shell');
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: t('organization'), title: data.org.name, href: `/o/${org}` }}
      nav={{
        base: `/o/${org}`,
        profile: data.profile,
        items: ORG_NAV.filter((i) => data.modules.has(i.module)),
      }}
    >
      {children}
    </ConsoleShell>
  );
}
