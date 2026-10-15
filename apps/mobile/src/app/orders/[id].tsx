import { useLocalSearchParams } from 'expo-router';
import { OrderScreen } from '../../orders/order-screen';

/** `/orders/[id]`; `?placed=1|pending` after a purchase. */
export default function OrderRoute() {
  const params = useLocalSearchParams<{ id: string; placed?: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const placed = params.placed === '1' ? 'confirmed' : params.placed === 'pending' ? 'pending' : null;
  return <OrderScreen id={id} placed={placed} />;
}
