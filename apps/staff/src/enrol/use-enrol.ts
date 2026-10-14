import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { type Enrolment, useDevice } from '../device';

export type EnrolError = 'invalid_link' | 'rejected' | 'wrong_event' | 'rateLimited' | 'unavailable';

/**
 * Enrolling from a screen (M7.4a): runs `device.enrol`, remembers what went wrong for the screen to
 * show, and on success leaves for the gate, which sends the device to the place picker.
 */
export function useEnrol() {
  const device = useDevice();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EnrolError | null>(null);
  const [retryAfterSeconds, setRetryAfter] = useState<number | null>(null);

  const enrol = useCallback(
    async (input: string | Enrolment): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const outcome = await device.enrol(input);
        if (outcome.kind === 'enrolled') {
          router.replace('/');
          return true;
        }
        setRetryAfter(outcome.kind === 'rateLimited' ? outcome.retryAfterSeconds : null);
        setError(outcome.kind);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [device, router],
  );

  return { busy, error, retryAfterSeconds, enrol, clearError: () => setError(null), setError };
}
