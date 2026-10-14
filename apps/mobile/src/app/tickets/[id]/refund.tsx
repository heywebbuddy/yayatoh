import { useLocalSearchParams } from 'expo-router';
import { RefundScreen } from '../../../tickets/screens/refund';

export default function RefundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RefundScreen id={String(id)} />;
}
