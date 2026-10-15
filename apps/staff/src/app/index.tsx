import { useSession } from '@yayatoh/mobile-core';
import { Redirect } from 'expo-router';
import { useDevice } from '../device';
import { usePortal } from '../portal';
import { Splash } from '../ui/splash';

/**
 * Where the app starts (M7.4a): the device gate. An enrolled device goes to its scanner, or to the
 * place picker until it has one; a signed-in organizer or exhibitor rep goes to the tools; anyone
 * else to enrolment. The splash shows while the stored enrolment and sessions are read.
 */
export default function Index() {
  const device = useDevice();
  const portal = usePortal();
  const session = useSession();
  if (!device.loaded || portal.status === 'loading' || session.status === 'loading') return <Splash />;
  if (device.status === 'enrolled') return <Redirect href={device.checkpointChosen ? '/scan' : '/select'} />;
  if (session.status === 'signedIn' || portal.status === 'signedIn') return <Redirect href="/tools" />;
  return <Redirect href="/enrol" />;
}
