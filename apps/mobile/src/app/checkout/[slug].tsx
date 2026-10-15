import { useLocalSearchParams } from 'expo-router';
import { CheckoutScreen } from '../../checkout/checkout-screen';

export default function CheckoutRoute() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? (params.slug[0] ?? '') : (params.slug ?? '');
  return <CheckoutScreen slug={slug} />;
}
