import { useSession } from '@yayatoh/mobile-core';
import { Redirect } from 'expo-router';
import { href, PATHS } from '../auth/routes';
import { SessionSplash } from '../auth/session-gate';

/**
 * Where the app opens (M7.3a): the stored session is read, then signed-in people land on Tickets
 * and everyone else on the welcome screen. Never a blank screen in between.
 */
export default function Index() {
  const session = useSession();
  if (session.status === 'loading') return <SessionSplash />;
  return <Redirect href={href(session.status === 'signedIn' ? PATHS.tickets : PATHS.welcome)} />;
}
