import { useLocalSearchParams } from 'expo-router';
import { ClaimScreen } from '../../tickets/screens/claim';

export default function ClaimRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <ClaimScreen token={String(token)} />;
}
