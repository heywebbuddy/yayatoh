import { useLocalSearchParams } from 'expo-router';
import { TicketDetailScreen } from '../../tickets/screens/ticket-detail';

export default function TicketRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TicketDetailScreen id={String(id)} />;
}
