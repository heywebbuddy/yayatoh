import { collectorTarget, publicCollectorQuery } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { collectAction } from './actions.ts';
import { CollectForm } from './collect-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('collector');
  // Shared by the hosts with their guests only: never indexed, never followed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * An event's public contact collector (M4.1f): `/collect/{code}`, shared as a link or QR code.
 * Guests leave their household's names, postal address, email and phone; it lands in the hosts'
 * approval queue (nothing reaches the guest list until they approve it). The page names the
 * event only, never anyone on the list. Off (or an unknown code): not found.
 */
export default async function CollectPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const code = decodeURIComponent(raw).toUpperCase();
  const target = await collectorTarget(code);
  if (!target) notFound();
  const view = await executeQuery(
    publicCollectorQuery,
    { eventId: target.eventId },
    createCtx({ orgId: target.orgId, locale }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!view) notFound();
  const t = await getTranslations('collector');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader
        eyebrow={<Label>{view.eventName}</Label>}
        title={t('title')}
        description={t('intro', { event: view.eventName })}
      />
      <CollectForm action={collectAction.bind(null, code)} challenge={humanCheckWidget()} />
    </main>
  );
}
