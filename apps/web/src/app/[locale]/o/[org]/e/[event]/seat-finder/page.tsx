import { redirect } from '@/i18n/navigation.ts';

/** The wedding profile's "Seat finder" nav item: its settings live with Seating (M1.7e). */
export default async function SeatFinderNavPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  redirect({ href: `/o/${org}/e/${event}/seating/finder`, locale });
}
