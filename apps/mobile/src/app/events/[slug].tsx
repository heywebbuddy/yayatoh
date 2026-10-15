import { useLocalSearchParams } from 'expo-router';
import { EventScreen } from '../../events/event-screen';
import { parseCheckoutReturn } from '../../shop/event-links';

/** `/events/[slug]`; the checkout's return and cancel links add `?checkout=…&order=…`. */
export default function EventRoute() {
  const params = useLocalSearchParams<{ slug: string; checkout?: string; order?: string }>();
  const slug = Array.isArray(params.slug) ? (params.slug[0] ?? '') : (params.slug ?? '');
  return <EventScreen slug={slug} marker={parseCheckoutReturn(params.checkout, params.order)} />;
}
