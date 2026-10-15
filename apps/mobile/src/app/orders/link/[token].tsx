import { useLocalSearchParams } from 'expo-router';
import { OrderLinkScreen } from '../../../orders/order-link-screen';

/** `/orders/link/[token]`: the link in an order email. */
export default function OrderLinkRoute() {
  const params = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(params.token) ? (params.token[0] ?? '') : (params.token ?? '');
  return <OrderLinkScreen token={token} />;
}
