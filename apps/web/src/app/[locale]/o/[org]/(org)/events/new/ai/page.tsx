import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AiEventSetup } from '@/components/ai-event-setup.tsx';
import { Link } from '@/i18n/navigation.ts';
import { PICKER_ORDER } from '@/lib/profile-picker.ts';
import { aiComposeSetup } from '@/server/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { createFromAiAction, proposeEventAction } from './actions.ts';

/**
 * "Create with AI": describe the event in a sentence or two, review and edit the proposal, then
 * create a draft event. Nothing is created without that last confirmation; without an AI provider
 * (or credits) the page says so and points to the manual ways to create an event.
 */
export default async function CreateWithAiPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations('aiSetup');
  const tg = await getTranslations();
  const setup = await aiComposeSetup(data.ctx);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link href={`/o/${org}/events/new/guided`} className={buttonClass('secondary')}>
              {tg('newEvent.guided')}
            </Link>
            <Link href={`/o/${org}/events/new`} className={buttonClass('secondary')}>
              {t('manual')}
            </Link>
          </>
        }
      />
      <AiEventSetup
        org={org}
        setup={setup}
        profiles={PICKER_ORDER.map((key) => ({ key, label: tg(`profiles.${key}` as 'profiles.other') }))}
        modules={{ ticketing: data.modules.has('ticketing'), sessions: data.modules.has('sessions') }}
        propose={proposeEventAction.bind(null, org)}
        create={createFromAiAction.bind(null, org)}
      />
    </>
  );
}
