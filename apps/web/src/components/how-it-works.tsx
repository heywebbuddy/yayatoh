import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { HELP_COOKIE, HELP_TOPICS, type HelpTopic, parseClosedHelp } from '@/lib/help-topics.ts';
import { HowItWorksPanel } from './how-it-works-panel.tsx';

/**
 * U2 (UX review 1, principle 3 "explain, then ask"): the "How it works" panel at the top of a
 * page that needs setup: what happens, in a few numbered steps, and a link to the guide in the
 * platform help center. It collapses, and the choice is remembered (a cookie, so the page renders
 * as the member left it).
 */
export async function HowItWorks({ topic, id }: { topic: HelpTopic; id?: string }) {
  const t = await getTranslations('howItWorks');
  const closed = parseClosedHelp((await cookies()).get(HELP_COOKIE)?.value);
  const { steps, query } = HELP_TOPICS[topic];
  return (
    <HowItWorksPanel
      topic={topic}
      id={id}
      initiallyOpen={!closed.has(topic)}
      title={t(`${topic}.title`)}
      intro={t(`${topic}.intro`)}
      steps={Array.from({ length: steps }, (_, i) => t(`${topic}.step${i + 1}`))}
      docLabel={t('docLink')}
      docHref={`/help/search?q=${encodeURIComponent(query)}`}
      hideLabel={t('hide')}
      showLabel={t('show')}
    />
  );
}
