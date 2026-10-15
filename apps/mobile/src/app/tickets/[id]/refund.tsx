import { useLocalSearchParams } from 'expo-router';
import { RefundScreen } from '../../../tickets/screens/refund';
import { SignedInOnly } from '../../../tickets/signed-in';

export default function RefundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SignedInOnly>
      <RefundScreen id={String(id)} />
    </SignedInOnly>
  );
}
