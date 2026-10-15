import { useLocalSearchParams } from 'expo-router';
import { LeadDetailScreen } from '../../../tools/screens/leads';

export default function LeadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LeadDetailScreen leadId={String(id)} />;
}
