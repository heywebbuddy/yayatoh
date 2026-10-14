import type { SignInOutcome } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useSignInFlow } from './flow';
import { needsStartOver, useOutcomeText, waitSeconds } from './outcomes';
import { go } from './routes';

export interface OutcomeState {
  readonly message: string | null;
  /** The person has to begin again: the code or challenge cannot be used any more. */
  readonly startOver: boolean;
  /** Seconds to wait before another attempt, when the server limited the request. */
  readonly wait: number | null;
}

const IDLE: OutcomeState = { message: null, startOver: false, wait: null };

/**
 * Shared by every screen that ends in a `SignInOutcome`: a second step goes to its screen, a
 * cancelled sheet does nothing, anything else becomes a message. A finished sign-in needs nothing
 * here: the session changes and the `(auth)` layout sends the person to Tickets.
 */
export function useOutcomeHandler(options: { emailedCode?: boolean } = {}) {
  const router = useRouter();
  const flow = useSignInFlow();
  const text = useOutcomeText();
  const [state, setState] = useState<OutcomeState>(IDLE);
  const emailedCode = options.emailedCode ?? false;

  const handle = useCallback(
    (outcome: SignInOutcome) => {
      switch (outcome.kind) {
        case 'signedIn':
        case 'cancelled':
          setState(IDLE);
          return;
        case 'twoFactor':
        case 'emailProof':
          setState(IDLE);
          flow.setPending({
            step: outcome.kind,
            challenge: outcome.challenge,
            expiresAt: outcome.expiresAt,
          });
          go(router, outcome.kind === 'twoFactor' ? '/two-factor' : '/link-proof');
          return;
        default:
          setState({
            message: text(outcome, { emailedCode }),
            startOver: needsStartOver(outcome),
            wait: waitSeconds(outcome),
          });
      }
    },
    [emailedCode, flow, router, text],
  );

  const clear = useCallback(() => setState(IDLE), []);
  return { ...state, handle, clear, setMessage: (message: string | null) => setState({ ...IDLE, message }) };
}
