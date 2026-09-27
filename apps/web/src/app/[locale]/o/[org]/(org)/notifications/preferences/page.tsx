import { executeQuery } from '@yayatoh/kernel';
import { myPreferencesQuery } from '@yayatoh/notifications';
import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PreferencesForm } from '@/components/preferences-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { savePreferencesAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.preferences');
  return { title: t('title') };
}

/** The signed-in member's notification settings: categories × channels. */
export default async function PreferencesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('notifications.preferences');
  const grid = await executeQuery(myPreferencesQuery, {}, data.ctx, ports);
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { org: data.org.name })} />
      <Card>
        <PreferencesForm
          action={savePreferencesAction.bind(null, org)}
          grid={grid.map((p) => ({ category: p.category, channel: p.channel, enabled: p.enabled }))}
        />
      </Card>
    </>
  );
}
