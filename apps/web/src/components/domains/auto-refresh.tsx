'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * While a domain is being set up (U3), reload the server data every `seconds` so the status the
 * background checks record shows up without a click. Paused while the tab is hidden.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
