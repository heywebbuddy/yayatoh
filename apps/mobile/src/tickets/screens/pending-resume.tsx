import { useCore, useSession } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { hrefs } from '../nav';
import { takePending } from '../pending';

/**
 * Picks up a claim or ticket link the person opened before signing in, now that there is a
 * session, and takes them to it. Renders nothing.
 */
export function PendingLinkResume() {
  const core = useCore();
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.status !== 'signedIn') return;
    let live = true;
    void takePending(core.storage).then((link) => {
      if (!live || !link) return;
      router.replace(link.kind === 'claim' ? hrefs.claim(link.token) : hrefs.ticketLink(link.token));
    });
    return () => {
      live = false;
    };
  }, [core, session.status, router]);
  return null;
}
