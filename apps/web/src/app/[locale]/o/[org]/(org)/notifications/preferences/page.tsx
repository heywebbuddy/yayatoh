import { getUserLocale, USER_LOCALES } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { myPreferencesQuery } from '@yayatoh/notifications';
import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MemberPushSection } from '@/components/member-push-section.tsx';
import { PreferencesForm } from '@/components/preferences-form.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { saveEmailLanguageAction, savePreferencesAction } from '../actions.ts';

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
  const emailLocale = (await getUserLocale(data.session.userId)) ?? 'en';
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { org: data.org.name })} />
      <Card>
        <PreferencesForm
          action={savePreferencesAction.bind(null, org)}
          grid={grid.map((p) => ({ category: p.category, channel: p.channel, enabled: p.enabled }))}
        />
      </Card>
      <MemberPushSection data={data} org={org} locale={locale} />
      <section aria-labelledby="email-language-heading" className="flex flex-col gap-3">
        <h2 id="email-language-heading" className="text-section">
          {t('language.title')}
        </h2>
        <Card>
          <SettingsForm
            action={saveEmailLanguageAction.bind(null, org)}
            submitLabel={t('language.save')}
            savedLabel={t('language.saved')}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email-language" className="text-caption text-ink-2">
                {t('language.label')}
              </label>
              <select
                id="email-language"
                name="locale"
                defaultValue={emailLocale}
                aria-describedby="email-language-hint"
                className="field max-w-sm"
              >
                {USER_LOCALES.map((l) => (
                  <option key={l} value={l} lang={l}>
                    {new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l}
                  </option>
                ))}
              </select>
              <p id="email-language-hint" className="text-caption text-ink-2">
                {t('language.hint')}
              </p>
            </div>
          </SettingsForm>
        </Card>
      </section>
    </>
  );
}
