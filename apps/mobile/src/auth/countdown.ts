import { useCallback, useEffect, useState } from 'react';

/** Counts whole seconds down to zero, once per second, from whatever `start` was last given. */
export function useCountdown(initial = 0) {
  const [remaining, setRemaining] = useState(initial);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  const start = useCallback((seconds: number) => setRemaining(Math.max(0, Math.ceil(seconds))), []);
  return { remaining, start };
}

/** A resend is available again this soon after a code went out, unless the server asks for longer. */
export const RESEND_AFTER_SECONDS = 30;
