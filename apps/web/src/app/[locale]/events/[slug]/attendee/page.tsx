import { permanentRedirect } from 'next/navigation';
import { getPathname } from '@/i18n/navigation.ts';

/**
 * Legacy parity (roadmap §7): the old attendee portal's seat finder lived at
 * `/events/{slug}/attendee`, and printed posters' QR codes point there. It is kept indefinitely
 * and resolves to the seat finder.
 */
export default async function LegacyAttendeePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  permanentRedirect(getPathname({ href: `/events/${encodeURIComponent(slug)}/seat-finder`, locale }));
}
