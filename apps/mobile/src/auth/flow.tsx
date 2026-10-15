/**
 * The state a sign-in carries from one screen to the next (M7.3a): the address the code went to and
 * the single-use challenge of a second step. It lives in memory only, never in the route, so a
 * challenge cannot leak through a navigation log, and a restart starts the sign-in over.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type PendingStep = 'twoFactor' | 'emailProof';

export interface PendingChallenge {
  readonly step: PendingStep;
  readonly challenge: string;
  readonly expiresAt: string | null;
}

export interface SignInFlow {
  /** The address an email code was sent to (empty before the first request). */
  readonly email: string;
  readonly pending: PendingChallenge | null;
  setEmail(email: string): void;
  setPending(next: PendingChallenge | null): void;
  /** Forget everything: after "Start again", a spent challenge or a finished sign-in. */
  reset(): void;
}

const FlowContext = createContext<SignInFlow | null>(null);

export function SignInFlowProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const reset = useCallback(() => {
    setEmail('');
    setPending(null);
  }, []);
  const value = useMemo<SignInFlow>(
    () => ({ email, pending, setEmail, setPending, reset }),
    [email, pending, reset],
  );
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useSignInFlow(): SignInFlow {
  const flow = useContext(FlowContext);
  if (!flow) throw new Error('useSignInFlow needs the (auth) layout');
  return flow;
}
