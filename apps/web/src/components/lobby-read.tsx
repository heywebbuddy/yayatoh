'use client';

import { useEffect } from 'react';

/** Marks the lobby read once it is open (the action also runs on each refresh of new messages). */
export function LobbyRead({ mark, count }: { mark: () => Promise<unknown>; count: number }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when new messages arrive
  useEffect(() => {
    void mark();
  }, [count]);
  return null;
}
