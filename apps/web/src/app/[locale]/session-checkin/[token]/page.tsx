import { selfCheckinDoor, selfCheckinPageQuery } from '@yayatoh/checkin';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { Card, EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SelfCheckinForm } from '@/components/self-checkin-form.tsx';
import { ports } from '@/server/ports.ts';
import { selfCheckinAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t('selfCheckin.metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** M5.6a: the page behind a session's self check-in flyer (phone-first; attendance only). */
export default async function SelfCheckinPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const door = await selfCheckinDoor(token);
  const page = door
    ? await executeQuery(selfCheckinPageQuery, { token }, createCtx({ orgId: door.orgId }), ports).catch(
        () => null,
      )
    : null;
  if (!page)
    return (
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
        <EmptyState title={t('selfCheckin.goneTitle')} description={t('selfCheckin.goneDescription')} />
      </main>
    );
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: page.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-label uppercase text-ink-2">{page.eventName}</p>
        <h1 className="text-title">{page.title}</h1>
        <p className="text-body text-ink-2">
          {when.formatRange(page.startsAt, page.endsAt)}
          {page.roomName ? ` · ${page.roomName}` : ''}
        </p>
      </header>
      {page.open ? (
        <Card>
          <SelfCheckinForm action={selfCheckinAction.bind(null, token)} />
        </Card>
      ) : (
        <EmptyState title={t('selfCheckin.closedTitle')} description={t('selfCheckin.closedDescription')} />
      )}
    </main>
  );
}
