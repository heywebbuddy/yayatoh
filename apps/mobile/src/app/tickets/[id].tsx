import { useLocalSearchParams } from 'expo-router';
import { TicketDetailScreen } from '../../tickets/screens/ticket-detail';
import { SignedInOnly } from '../../tickets/signed-in';

export default function TicketRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SignedInOnly>
      <TicketDetailScreen id={String(id)} />
    </SignedInOnly>
  );
}
