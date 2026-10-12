import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';

/**
 * The wedding's RSVP menu item (agreement §5): the RSVP screens live with the guest list
 * (`guests/rsvp`: deadline, progress, links and PINs). This section used to be a "coming soon"
 * placeholder; it now opens them for anyone the RSVP item is shown to.
 */
export default async function RsvpSectionPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  const { data, can } = await loadEvent(org, event, 'rsvp');
  if (!data.modules.has('guests') || !can('guests:read')) notFound();
  redirect({ href: `/o/${org}/e/${event}/guests/rsvp`, locale });
}
