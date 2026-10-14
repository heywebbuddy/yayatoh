import { useLocalSearchParams } from 'expo-router';
import { TransferScreen } from '../../../tickets/screens/transfer';

export default function TransferRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransferScreen id={String(id)} />;
}
