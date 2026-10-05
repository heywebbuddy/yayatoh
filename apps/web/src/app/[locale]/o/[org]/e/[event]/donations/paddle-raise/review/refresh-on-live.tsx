'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';

/** Re-reads the review when the console channel says something changed (entries synced, pledges). */
export function RefreshOnLive({ url }: { url: string }) {
  const router = useRouter();
  const first = useRef(true);
  useRealtime(url, ['snapshot', 'state'], {
    snapshot: () => {
      // The first snapshot is what the page already shows; later ones follow a reconnect.
      if (first.current) first.current = false;
      else router.refresh();
    },
    state: () => router.refresh(),
  });
  return null;
}
