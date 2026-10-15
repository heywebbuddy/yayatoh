import { useLocalSearchParams } from 'expo-router';
import { TransferScreen } from '../../../tickets/screens/transfer';
import { SignedInOnly } from '../../../tickets/signed-in';

export default function TransferRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SignedInOnly>
      <TransferScreen id={String(id)} />
    </SignedInOnly>
  );
}
