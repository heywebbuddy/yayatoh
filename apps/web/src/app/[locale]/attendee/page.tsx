import { AttendeeView } from '@/components/attendee-view.tsx';
export default async function AttendeePage({ params }: { params: Promise<{ locale: string }> }) {
  return <AttendeeView locale={(await params).locale} section="overview" />;
}
