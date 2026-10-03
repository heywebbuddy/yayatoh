import { roleCan } from '@yayatoh/tenancy';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { visibleOrgSections } from '@/lib/org-nav.ts';
import { openAlertCount } from '@/server/alerts.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsoleBase } from '@/server/console.ts';

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  // The org home serves collaborators too (their events); every other org page refuses them.
  const data = await loadConsoleBase(org);
  const t = await getTranslations();
  const openAlerts = await openAlertCount(data);
  // U2: the grouped sidebar (lib/org-nav.ts): only what this member may open in this org.
  const sections = visibleOrgSections({
    role: data.role,
    can: (p) => roleCan(data.role, p),
    modules: data.modules,
    contentOrg: isPlatformContentOrg(data.org.slug),
    agencyOrg: data.org.kind === 'agency',
    viaAgency: Boolean(data.agency),
  }).map((s) => ({
    key: s.key,
    label: t(`shell.sections.${s.key}`),
    items: s.items.map((i) => ({ key: i.key, path: i.path, icon: i.icon, label: t(`nav.${i.key}`) })),
  }));
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: t('shell.organization'), title: data.org.name, href: `/o/${org}` }}
      nav={{
        base: `/o/${org}`,
        profile: data.profile,
        items: [],
        sections,
        badges: openAlerts > 0 ? { alerts: String(openAlerts) } : {},
      }}
    >
      {children}
    </ConsoleShell>
  );
}
