'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-render the server page every `seconds` while the tab is visible: the polling fallback
 * until realtime (Ably, roadmap §6.4) is connected.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
