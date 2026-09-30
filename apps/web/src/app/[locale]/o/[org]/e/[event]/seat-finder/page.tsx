import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';

/** The wedding profile's "Seat finder" nav item: its settings live with Seating (M1.7e). */
export default async function SeatFinderNavPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  // M4.2a: only where the profile lists the seat finder (a 404 elsewhere, e.g. a gala).
  await loadEvent(org, event, 'seatFinder');
  redirect({ href: `/o/${org}/e/${event}/seating/finder`, locale });
}
