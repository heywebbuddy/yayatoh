import { partyCardTarget } from '@yayatoh/donations';
import { rsvpLinkRef } from '@yayatoh/guests';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pageLocale } from '@/server/locale.ts';
import { CardPage } from '../../../events/[slug]/card/card-page.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('savedCard');
  // A party's page is theirs alone: never indexed, never followed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * A party's card page (M4.8e), `/rsvp/{token}/card`: reached from the party's own link (the QR
 * code on its place card, and its seat page). The saved card pays this party's pledges.
 */
export default async function PartyCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ saved?: string; removed?: string }>;
}) {
  const { locale, token: raw } = await params;
  pageLocale(locale);
  const token = decodeURIComponent(raw);
  const ref = await rsvpLinkRef(token);
  const party = ref ? await partyCardTarget(ref.orgId, token) : null;
  if (!ref || !party) notFound();
  const sp = await searchParams;
  return (
    <CardPage
      orgId={ref.orgId}
      eventId={party.eventId}
      eventName={party.eventName}
      organizer={party.eventName}
      slug={party.slug}
      target={{ slug: null, rsvpToken: token, source: 'party' }}
      partyName={party.partyName}
      saved={sp.saved === '1'}
      removed={sp.removed === '1'}
    />
  );
}
