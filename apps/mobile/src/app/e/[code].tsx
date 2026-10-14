import { useLocalSearchParams } from 'expo-router';
import { ShortLinkScreen } from '../../events/short-link-screen';

/** `/e/[code]`: a short link to an event. */
export default function ShortLinkRoute() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = Array.isArray(params.code) ? (params.code[0] ?? '') : (params.code ?? '');
  return <ShortLinkScreen code={code} />;
}
