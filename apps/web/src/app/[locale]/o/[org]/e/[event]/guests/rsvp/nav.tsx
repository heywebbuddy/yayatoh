import { Tabs, tabClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';

/**
 * The breadcrumb of the Guests sub-pages (ADR 0022): organization › event › Guests (the
 * profile's word for it) › any further steps › this page.
 */
export function GuestsCrumbs({
  org,
  event,
  orgName,
  eventName,
  guestsLabel,
  trail,
}: {
  org: string;
  event: string;
  orgName: string;
  eventName: string;
  guestsLabel: string;
  /** The steps after Guests; the last one (without a link) is the current page. */
  trail: readonly { label: ReactNode; href?: string }[];
}) {
  return (
    <Crumbs
      items={[
        { label: orgName, href: `/o/${org}` },
        { label: eventName, href: `/o/${org}/e/${event}` },
        { label: guestsLabel, href: `/o/${org}/e/${event}/guests` },
        ...trail,
      ]}
    />
  );
}

/** The RSVP pages as segmented tabs: links, QR codes and deadline; questions; answers. */
export async function RsvpTabs({
  org,
  event,
  current,
}: {
  org: string;
  event: string;
  current: 'rsvp' | 'questions' | 'answers';
}) {
  const t = await getTranslations();
  const base = `/o/${org}/e/${event}/guests`;
  const tabs = [
    ['rsvp', t('rsvpHost.title')],
    ['questions', t('rsvpQuestions.title')],
    ['answers', t('rsvpAnswers.title')],
  ] as const;
  return (
    <Tabs label={t('rsvpQuestions.linksLabel')} className="self-start print:hidden">
      {tabs.map(([key, label]) => (
        <Link
          key={key}
          href={`${base}/${key}`}
          aria-current={key === current ? 'page' : undefined}
          className={tabClass(key === current)}
        >
          {label}
        </Link>
      ))}
    </Tabs>
  );
}
