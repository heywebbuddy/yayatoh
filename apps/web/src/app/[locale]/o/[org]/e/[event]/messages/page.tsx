import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';

/**
 * The wedding's Messages menu item (agreement §5 and §7): invitations, RSVP reminders and their
 * delivery by email and text live with the guest list (`guests/invitations`). This section used
 * to be a "coming soon" placeholder; it now opens them.
 */
export default async function MessagesSectionPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  const { data, can } = await loadEvent(org, event, 'messages');
  if (!data.modules.has('guests') || !can('guests:read')) notFound();
  redirect({ href: `/o/${org}/e/${event}/guests/invitations`, locale });
}
