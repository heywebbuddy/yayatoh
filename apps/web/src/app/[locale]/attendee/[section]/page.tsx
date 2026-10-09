import { notFound } from 'next/navigation';
import { AttendeeView } from '@/components/attendee-view.tsx';
import { ATTENDEE_SECTIONS, type AttendeeSection } from '@/lib/attendee.ts';
export default async function AttendeeSectionPage({
  params,
}: {
  params: Promise<{ locale: string; section: string }>;
}) {
  const { locale, section } = await params;
  if (!ATTENDEE_SECTIONS.includes(section as AttendeeSection) || section === 'overview') notFound();
  return <AttendeeView locale={locale} section={section as AttendeeSection} />;
}
