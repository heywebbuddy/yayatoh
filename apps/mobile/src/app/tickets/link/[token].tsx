import { useLocalSearchParams } from 'expo-router';
import { TicketLinkScreen } from '../../../tickets/screens/ticket-link';

export default function TicketLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <TicketLinkScreen token={String(token)} />;
}
